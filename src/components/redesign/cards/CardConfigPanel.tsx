// LORAMER_NEXT_CARD_ENGINE_V1 — the card config SIDE-PANEL (piece 2; NOT inline-on-card, per locked decision B).
// Edits one CardConfig. Breakdown families marked coming=true are shown but DISABLED (captured, not query-exposed
// yet = surfacing dep #2) — selecting them is blocked so no card ever renders fake data.
'use client'
import { useState } from 'react'
import type { CardConfig, CardKind, VizType } from './card-types'
import { STAT_METRICS, STORE_STAT_METRICS, BREAKDOWN_CATALOG, STORE_FAMILIES, DATE_RANGES, ROAS_BASES, ALL_ROAS_BASES } from './card-types'
import styles from './cards.module.css'

const VIZ_FOR: Record<CardKind, VizType[]> = {
  stat: ['stat'],
  breakdown: ['bar', 'table'],
  timeseries: ['line'],
  money: ['money'], // LORAMER_NEXT_MONEY_CARD_V1 — additive; no metric/breakdown config (auto-detects the store platform)
  roas: ['roas'],   // LORAMER_NEXT_ROAS_CARD_V1 — additive; config = which basis-labeled sources are checked (below)
}

// LORAMER_META_CONV_ACTION_CARD_ENABLE_V1 — PER-BREAKDOWN config defaults applied when the user picks that
// breakdown. action_type is a spend=0 WRITE-ONLY family, so a default rank-by-spend ties every row at 0 →
// default it to rank-by-conversions + a table viz (user still overridable below). Absent key → NO override,
// so every other breakdown type keeps its existing defaults untouched.
const BREAKDOWN_DEFAULTS: Record<string, Partial<CardConfig>> = {
  action_type: { rankBy: 'conversions', viz: 'table' },
}

export default function CardConfigPanel({ initial, onApply, onClose, source, storePlatform }: { initial: CardConfig; onApply: (c: CardConfig) => void; onClose: () => void; source?: string; storePlatform?: string }) {
  const [cfg, setCfg] = useState<CardConfig>(initial)
  const set = (patch: Partial<CardConfig>) => setCfg((c) => ({ ...c, ...patch }))
  // LORAMER_NEXT_STORE_CATALOG_V1 — SOURCE-AWARE: on a store page (source==='store') the panel offers ONLY store-relevant
  // options (net revenue/orders/AOV · store product/variant families for the active storePlatform), sets store setKind
  // defaults, and stamps source:'store'+storePlatform on apply. Off a store page it is UNCHANGED (ad metrics/families).
  const isStore = source === 'store'
  const metricList = isStore ? STORE_STAT_METRICS : STAT_METRICS
  const breakdownList = isStore
    ? BREAKDOWN_CATALOG.filter((b) => STORE_FAMILIES.has(b.key) && b.platform === storePlatform)
    : BREAKDOWN_CATALOG.filter((b) => !STORE_FAMILIES.has(b.key))
  const rankByList = isStore ? ['revenue', 'conversions'] : ['spend', 'conversions', 'conversionValue', 'clicks', 'impressions']
  const setKind = (kind: CardKind) => set({
    kind, viz: VIZ_FOR[kind][0],
    ...(kind === 'stat' ? { metric: isStore ? 'revenue' : 'spend' } : {}),
    ...(kind === 'breakdown' ? (isStore ? { breakdownType: 'product', rankBy: 'revenue', topN: 8 } : { breakdownType: 'age', rankBy: 'spend', topN: 8 }) : {}),
    ...(kind === 'roas' ? { roasBases: ALL_ROAS_BASES } : {}),
  })
  // stamp source+storePlatform onto every store-panel apply (belt-and-suspenders; the engine default already carries them).
  const apply = () => onApply(isStore ? { ...cfg, source: 'store', storePlatform } : cfg)

  return (
    <div className={styles.panel} role="dialog" aria-label="Card settings">
      <div className={styles.panelHead}>
        <span>Card settings</span>
        <button type="button" className={styles.act} onClick={onClose}><i className="ti ti-x" /></button>
      </div>
      <div className={styles.panelBody}>
        <label className={styles.fLabel}>Type</label>
        <div className={styles.seg}>
          {(['stat', 'breakdown', 'timeseries', 'money', 'roas'] as CardKind[]).map((k) => (
            <button key={k} type="button" className={cfg.kind === k ? styles.segOn : styles.segBtn} onClick={() => setKind(k)}>{k}</button>
          ))}
        </div>

        {cfg.kind === 'stat' && (
          <>
            <label className={styles.fLabel}>Metric</label>
            <select className={styles.sel} value={cfg.metric} onChange={(e) => set({ metric: e.target.value })}>
              {metricList.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </>
        )}

        {cfg.kind === 'breakdown' && (
          <>
            <label className={styles.fLabel}>Breakdown</label>
            <select className={styles.sel} value={cfg.breakdownType} onChange={(e) => set({ breakdownType: e.target.value, ...(BREAKDOWN_DEFAULTS[e.target.value] || {}) })}>
              {breakdownList.map((b) => (
                <option key={`${b.key}:${b.platform}`} value={b.key} disabled={b.coming}>{b.label}{b.coming ? ' — coming' : ''}</option>
              ))}
            </select>
            <label className={styles.fLabel}>Rank by</label>
            <select className={styles.sel} value={cfg.rankBy || (isStore ? 'revenue' : 'spend')} onChange={(e) => set({ rankBy: e.target.value })}>
              {rankByList.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <label className={styles.fLabel}>Top N</label>
            <input className={styles.sel} type="number" min={1} max={50} value={cfg.topN || 8} onChange={(e) => set({ topN: Math.max(1, Math.min(50, Number(e.target.value) || 8)) })} />
          </>
        )}

        {/* LORAMER_NEXT_ROAS_CARD_V1 — the multi-source ROAS card: user checks which basis-labeled sources to show.
            Default = all checked (ALL_ROAS_BASES). Persisted as roasBases[] on the CardConfig (view JSONB). */}
        {cfg.kind === 'roas' && (
          <>
            <label className={styles.fLabel}>ROAS sources</label>
            {ROAS_BASES.map((b) => {
              const on = (cfg.roasBases ?? ALL_ROAS_BASES).includes(b.key)
              return (
                <label key={b.key} className={styles.checkRow}>
                  <input type="checkbox" checked={on} onChange={(e) => {
                    const cur = new Set(cfg.roasBases ?? ALL_ROAS_BASES)
                    if (e.target.checked) cur.add(b.key); else cur.delete(b.key)
                    set({ roasBases: ROAS_BASES.map((x) => x.key).filter((k) => cur.has(k)) }) // keep catalog order
                  }} />
                  {b.label}
                </label>
              )
            })}
          </>
        )}

        <label className={styles.fLabel}>View</label>
        <div className={styles.seg}>
          {VIZ_FOR[cfg.kind].map((v) => (
            <button key={v} type="button" className={cfg.viz === v ? styles.segOn : styles.segBtn} onClick={() => set({ viz: v })}>{v}</button>
          ))}
        </div>

        {/* RESHAPE: by DEFAULT the card inherits the page GLOBAL range; this checkbox is the by-exception override. */}
        <label className={styles.fLabel}>Date range</label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={!!cfg.useCustomRange} onChange={(e) => set({ useCustomRange: e.target.checked })} />
          Use a custom range for this card
        </label>
        {cfg.useCustomRange ? (
          <select className={styles.sel} value={cfg.dateRange} onChange={(e) => set({ dateRange: e.target.value })}>
            {DATE_RANGES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        ) : (
          <p className={styles.muted}>Inherits the page date range.</p>
        )}

        <label className={styles.fLabel}>Title (optional)</label>
        <input className={styles.sel} type="text" value={cfg.title || ''} placeholder="Auto" onChange={(e) => set({ title: e.target.value || undefined })} />
      </div>
      <div className={styles.panelFoot}>
        <button type="button" className={styles.primary} onClick={apply}>Apply</button>
        <button type="button" className={styles.ghost} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
