// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 / _WORKING_LAYOUT_V1 — the PAGE-AGNOSTIC engine. Takes { pageKey, clientId,
// defaultView }; portfolio/client pages reuse it with a different pageKey (no rebuild). Owns: the per-(viewer,page,client)
// WORKING layout (autosaved), named snapshots, the page GLOBAL date range (Shopify model), the page COMPARE mode,
// the Customize toggle, add/edit/remove/pin, the side-panel config, full-screen, the grid. Renders REAL data only.
//
// LORAMER_NEXT_WORKING_LAYOUT_V1 — persistence model:
//   • ONE working layout per (user_email, page_key, client_id) = the row named 'Default' (WORKING). Mount ALWAYS loads
//     it, else defaultOverviewView(). Every mutation (add/edit/remove/pin/drag-settle/period/compare) AUTOSAVES back to
//     it (debounced); "Done" flushes it immediately; leaving the client/closing the tab flushes any pending edit.
//   • "Save view" writes a SEPARATE NAMED snapshot row (never 'Default'); snapshots are NOT auto-loaded on mount and are
//     untouched by working-layout edits. Re-picking a snapshot COPIES it into the working row + loads it; the next edit
//     peels off into the working row (the snapshot stays as saved).
//   • Lesson 53: a restored working layout is RE-VALIDATED against the (newly-switched) client before it renders —
//     valid non-blank period, non-empty card set, no stale/incomplete custom range.
'use client'
import { useEffect, useRef, useState } from 'react'
import type { CardConfig, GridItem, SavedView } from './card-types'
import { defaultOverviewView, newCardId } from './card-types'
import { RANGE_PRESETS, COMPARE_PRESETS, type ComparePreset, type Win } from '@/lib/next/card-windows'
import { setSharedPeriod } from '@/lib/next/period-bus' // LORAMER_NEXT_CHAT_POLISH_V1 — publish the page period to the Ask-Lora chat
import CardGrid from './CardGrid'
import CardConfigPanel from './CardConfigPanel'
import styles from './cards.module.css'

const WORKING = 'Default'          // the reserved name of the per-(viewer,page,client) working layout row
const SAVE_DEBOUNCE_MS = 800       // coalesce drag/rapid edits into one write; "Done"/leave flush immediately
const ISO = /^\d{4}-\d{2}-\d{2}$/

// LORAMER_NEXT_WORKING_LAYOUT_V1 — Lesson 53: re-validate a restored working view against the incoming client before it
// renders. Never carry a stale blank: land on a valid non-blank period, a non-empty card set, and drop an incomplete
// custom range. (Cards themselves render honestly empty/no-data per client, so no per-card capability pruning here.)
function revalidate(v: SavedView): SavedView {
  const presets = new Set(RANGE_PRESETS.map((r) => r.key))
  const period = presets.has(v.globalPeriod || '') ? (v.globalPeriod as string) : 'LAST_30_DAYS'
  const custom = v.globalCustom && ISO.test(v.globalCustom.startDate || '') && ISO.test(v.globalCustom.endDate || '') ? v.globalCustom : null
  const base = defaultOverviewView()
  const cards = Array.isArray(v.cards) && v.cards.length ? v.cards : base.cards
  const layout = Array.isArray(v.layout) && v.layout.length ? v.layout : base.layout
  // LORAMER_NEXT_MOBILE_LAYOUT_V1 — mobile (sm) layout is ADDITIVE + OPTIONAL: normalize to [] when absent so a
  // legacy row (desktop layout only) falls back to cards[]-order stacking on mobile (renders identically to before).
  const layoutSm = Array.isArray(v.layoutSm) ? v.layoutSm : []
  return { ...v, cards, layout, layoutSm, pinned: v.pinned || [], globalPeriod: period, globalCustom: custom, compareMode: v.compareMode || 'none', customCompare: v.customCompare || null }
}

export default function CardEngine({ pageKey, clientId, defaultView, source, storePlatform }: { pageKey: string; clientId: string; defaultView?: SavedView; source?: string; storePlatform?: string }) {
  // LORAMER_NEXT_STORE_CATALOG_V1 — a store page passes source='store' + the resolved storePlatform; they thread to the
  // config panel (store-scoped add-card options) and seed the NEW-card default so "Add card" mints a store card, not a
  // portfolio spend card. Off a store page both are undefined → every path is byte-identical to before.
  const fallback = revalidate(defaultView || defaultOverviewView())
  const [snapshots, setSnapshots] = useState<SavedView[]>([]) // named saved views (name !== WORKING); the picker only
  const [cards, setCards] = useState<CardConfig[]>(fallback.cards)
  const [layout, setLayout] = useState<GridItem[]>(fallback.layout)
  const [layoutSm, setLayoutSm] = useState<GridItem[]>(fallback.layoutSm || []) // LORAMER_NEXT_MOBILE_LAYOUT_V1 — sm arrangement, independent of desktop `layout`
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

  // LORAMER_NEXT_WORKING_LAYOUT_V1 — autosave plumbing: a hydration guard so a load doesn't immediately re-save, a debounce
  // timer, and a pending-body ref so we can flush the LAST edit on client-switch / tab-close (keepalive) with no loss.
  const hydratingRef = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<any | null>(null)

  const buildWorkingView = (): SavedView => ({ name: WORKING, cards, layout, layoutSm, pinned: Array.from(pinned), globalPeriod, globalCustom, compareMode, customCompare })
  const flushWorking = () => {
    const body = pendingRef.current
    if (!body) return
    pendingRef.current = null
    try { void fetch('/api/next/layouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }) } catch { /* honest: a failed autosave is silent; Done surfaces errors */ }
  }
  // apply a view into the live working state (re-validated per Lesson 53).
  const applyWorking = (v: SavedView) => {
    const r = revalidate(v)
    setCards(r.cards); setLayout(r.layout); setLayoutSm(r.layoutSm || []); setPinned(new Set(r.pinned || []))
    setGlobalPeriod(r.globalPeriod || 'LAST_30_DAYS'); setGlobalCustom(r.globalCustom || null)
    setCompareMode(r.compareMode || 'none'); setCustomCompare(r.customCompare || null)
  }

  // publish the page's shared date range so the Ask-Lora chat's ambient window follows it.
  useEffect(() => {
    setSharedPeriod({ dateRange: globalPeriod, customStart: globalCustom?.startDate, customEnd: globalCustom?.endDate })
  }, [globalPeriod, globalCustom])

  // ── mount / CLIENT SWITCH: load the WORKING row (name===WORKING) else the built-in default; snapshots feed the picker.
  // The cleanup flushes any pending working edit for the OUTGOING client before we load the next one (no loss on switch).
  useEffect(() => {
    let alive = true
    hydratingRef.current = true
    fetch(`/api/next/layouts?pageKey=${encodeURIComponent(pageKey)}&clientId=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        const rows: SavedView[] = Array.isArray(d?.views) ? d.views : []
        setSnapshots(rows.filter((v) => v.name !== WORKING))
        hydratingRef.current = true // the load's state change must NOT trigger an autosave
        applyWorking(rows.find((v) => v.name === WORKING) || defaultView || defaultOverviewView())
      })
      .catch(() => { if (alive) { hydratingRef.current = true; applyWorking(defaultView || defaultOverviewView()) } })
    return () => { alive = false; flushWorking() }
  }, [pageKey, clientId])

  // ── AUTOSAVE: any working-state change → arm a debounced write to the WORKING row (the load itself is skipped) ──
  useEffect(() => {
    if (hydratingRef.current) { hydratingRef.current = false; return }
    pendingRef.current = { pageKey, clientId, view: buildWorkingView(), setDefault: true }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushWorking, SAVE_DEBOUNCE_MS)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [cards, layout, layoutSm, pinned, globalPeriod, globalCustom, compareMode, customCompare])

  // flush the last edit if the tab is hidden/closed mid-debounce.
  useEffect(() => {
    const h = () => flushWorking()
    window.addEventListener('pagehide', h)
    return () => window.removeEventListener('pagehide', h)
  }, [])

  const editingCfg: CardConfig | null =
    editing === 'new'
      ? { id: newCardId(), kind: 'stat', viz: 'stat', dateRange: 'LAST_30_DAYS', useCustomRange: false,
          ...(source === 'store' ? { source: 'store' as const, storePlatform, metric: 'revenue' } : { metric: 'spend' }) }
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

  // "Done" — flush the working layout NOW (even if the debounce hasn't fired) and exit customize.
  const flushNow = () => { if (saveTimer.current) clearTimeout(saveTimer.current); pendingRef.current = { pageKey, clientId, view: buildWorkingView(), setDefault: true }; flushWorking() }
  const doneCustomizing = () => { setCustomizing(false); flushNow(); setSaveMsg('Saved'); setTimeout(() => setSaveMsg(null), 2500) }

  // "Save view" — write a SEPARATE NAMED snapshot (never WORKING; never sets is_default → never hijacks the mount load).
  const saveSnapshot = async () => {
    const raw = window.prompt('Save this view as:', 'My view')
    if (!raw) return
    const name = raw.trim()
    if (!name) return
    if (name.toLowerCase() === WORKING.toLowerCase()) { setSaveMsg('“Default” is reserved'); setTimeout(() => setSaveMsg(null), 3000); return }
    const snap: SavedView = { ...buildWorkingView(), name }
    setSaveMsg('Saving…')
    try {
      const r = await fetch('/api/next/layouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageKey, clientId, view: snap, setDefault: false }) })
      if (!r.ok) throw new Error()
      setSnapshots((s) => { const i = s.findIndex((v) => v.name === name); const n = [...s]; i >= 0 ? (n[i] = snap) : n.push(snap); return n })
      setSaveMsg('Saved')
    } catch { setSaveMsg('Couldn’t save') }
    setTimeout(() => setSaveMsg(null), 3000)
  }

  // Re-pick a snapshot → COPY it into the working row + load it (peel-off applies on the next edit; snapshot untouched).
  const loadSnapshot = (name: string) => {
    const snap = snapshots.find((v) => v.name === name)
    if (!snap) return
    const r = revalidate(snap)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    hydratingRef.current = true       // the applyWorking state change is redundant with the explicit write below → skip it
    applyWorking(r)
    pendingRef.current = { pageKey, clientId, view: { ...r, name: WORKING }, setDefault: true }
    flushWorking()
  }

  const onRange = (key: string) => {
    if (key === 'CUSTOM') { setCustomRangeOpen(true); return } // reveal the date inputs; apply on Apply
    setCustomRangeOpen(false); setGlobalCustom(null); setGlobalPeriod(key)
  }
  const applyCustomRange = () => { if (rangeDraft.startDate && rangeDraft.endDate) setGlobalCustom({ ...rangeDraft }) }
  const onCompare = (key: ComparePreset) => { setCompareMode(key); if (key !== 'custom') setCustomCompare(null) }
  const applyCustomCompare = () => { if (cmpDraft.startDate && cmpDraft.endDate) setCustomCompare({ ...cmpDraft }) }

  return (
    <div className={`${styles.engine} ${fullscreen ? styles.fullscreen : ''}`}>
      <div className={styles.toolbar}>
        {/* Re-pick a saved snapshot into the working layout (mount still loads the working row, not a snapshot). */}
        {snapshots.length > 0 && (
          <select className={styles.viewSel} value="" onChange={(e) => { if (e.target.value) { loadSnapshot(e.target.value); e.target.value = '' } }} title="Load a saved view">
            <option value="">Saved views…</option>
            {snapshots.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
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

          <button type="button" className={customizing ? styles.toolOn : styles.tool} onClick={() => (customizing ? doneCustomizing() : setCustomizing(true))}>
            <i className="ti ti-adjustments" /> {customizing ? 'Done' : 'Customize'}
          </button>
          {customizing && <button type="button" className={styles.tool} onClick={() => setEditing('new')}><i className="ti ti-plus" /> Add card</button>}
          {customizing && <button type="button" className={styles.tool} onClick={saveSnapshot}><i className="ti ti-device-floppy" /> Save view</button>}
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
        clientId={clientId} cards={cards} layout={layout} layoutSm={layoutSm} pinned={pinned} customizing={customizing}
        globalPeriod={globalPeriod} globalCustom={globalCustom} compareMode={compareMode} customCompare={customCompare}
        onLayoutChange={setLayout} onLayoutSmChange={setLayoutSm} onEdit={(id) => setEditing(id)} onRemove={removeCard} onTogglePin={togglePin}
      />

      {editingCfg && <CardConfigPanel initial={editingCfg} source={source} storePlatform={storePlatform} onApply={applyCfg} onClose={() => setEditing(null)} />}
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
