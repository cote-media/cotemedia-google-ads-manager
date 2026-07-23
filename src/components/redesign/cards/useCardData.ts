// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the ONE data hook for every card. Dispatches by kind to OWNER-GATED
// -next routes. Takes the RESOLVED current window + optional compare window (the engine resolves global-vs-override
// + the page compare mode and passes explicit dates). Returns current value + the compare-window value (for deltas).
// HONEST states: loading / error ("couldn't load") / empty ("no data") — never a fabricated zero. timeseries cards
// render their own chart (CombinedPerformanceChart / CompareLine), so this hook handles stat + breakdown only.
'use client'
import { useEffect, useState } from 'react'
import type { CardConfig } from './card-types'
import type { Win } from '@/lib/next/card-windows'

export interface BreakdownRow { value: string; spend: number; conversions: number; conversionValue: number; impressions: number; clicks: number; revenue: number; metaRoas?: number | null; cmpRank?: number; geoId?: string; geoName?: string; geoCanonicalName?: string; geoLocationType?: string; geoResolved?: boolean } // metaRoas: LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — Meta-reported ROAS, present only on the canonicalized action_type card rows | geo*: LORAMER_GEO_RESOLVE_V1 — resolved place name alongside the raw geoTargetConstants id (google geo breakdowns only)
export interface CardData {
  loading: boolean
  error: string | null
  hasCompare: boolean
  statValue?: number | null
  statCompare?: number | null
  rows?: BreakdownRow[]
  note?: string
  incompleteNote?: string // LORAMER_QUERY_COMPLETENESS_V1 slice 2 — set when a platform's failing/stale capture makes this total PARTIAL
}

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
// LORAMER_QUERY_COMPLETENESS_V1 slice 2 — the "partial" caption is built SERVER-SIDE (one place, buildIncompleteNote)
// and returned as d.incompleteNote by client-metrics / store-stats; this hook just carries it through.
const winParams = (cur: Win, cmp: Win | null) => {
  const p: Record<string, string> = { start: cur.startDate, end: cur.endDate }
  if (cmp) { p.cmpStart = cmp.startDate; p.cmpEnd = cmp.endDate }
  return p
}

export function useCardData(clientId: string, cfg: CardConfig, current: Win, compare: Win | null): CardData {
  const [data, setData] = useState<CardData>({ loading: true, error: null, hasCompare: !!compare })
  const cmpKey = compare ? compare.startDate + compare.endDate : ''

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setData({ loading: true, error: null, hasCompare: !!compare })
    const fail = () => { if (alive) setData({ loading: false, error: 'Couldn’t load', hasCompare: !!compare }) }

    // LORAMER_NEXT_STORE_PAGE_V1 — STORE cards read the store-scoped reads (FLIGHT 1) instead of the portfolio-combined
    // ones. Gated on cfg.source==='store' → every non-store (Overview) card falls through to the UNCHANGED paths below.
    if (cfg.source === 'store') {
      if (cfg.kind === 'stat') {
        const field = cfg.metric === 'orders' ? 'orders' : cfg.metric === 'aov' ? 'aov' : 'revenue' // store-stats fields
        const one = (w: Win) => {
          const p = new URLSearchParams({ clientId, start: w.startDate, end: w.endDate })
          if (cfg.storePlatform) p.set('platform', cfg.storePlatform)
          return fetch(`/api/next/store-stats?${p.toString()}`).then((r) => (r.ok ? r.json() : Promise.reject()))
        }
        Promise.all([one(current), compare ? one(compare) : Promise.resolve(null)])
          .then(([cur, cmp]) => { if (alive) setData({ loading: false, error: null, hasCompare: !!compare, statValue: num(cur?.[field]), statCompare: cmp ? num(cmp[field]) : null, incompleteNote: cur?.incompleteNote }) }) // LORAMER_QUERY_COMPLETENESS_V1 slice 2 — store card partial marker
          .catch(fail)
        return () => { alive = false }
      }
      if (cfg.kind === 'breakdown' && cfg.breakdownType === 'customer_mix') {
        // Honest coming-soon: the privacy-safe (0-PII) customer engine is unbuilt → a note, NEVER fabricated rows.
        if (alive) setData({ loading: false, error: null, hasCompare: false, rows: [], note: 'Customer mix (new vs returning) is coming soon — the privacy-safe customer engine is not built yet.' })
        return () => { alive = false }
      }
      if (cfg.kind === 'breakdown' && (cfg.breakdownType === 'product' || cfg.breakdownType === 'variant')) {
        // LORAMER_NEXT_STORE_CATALOG_V1 — product AND variant grains both read /api/next/entities (level = the family);
        // variant read-probed clean on real Foam OH rows (named, revenue>0, no false zeros).
        const p = new URLSearchParams({ clientId, platform: cfg.storePlatform || 'shopify', level: cfg.breakdownType, start: current.startDate, end: current.endDate })
        fetch(`/api/next/entities?${p.toString()}`)
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((d) => {
            if (!alive) return
            const rows: BreakdownRow[] = (Array.isArray(d.rows) ? d.rows : []).map((r: any) => ({
              value: r.entityName || '(unnamed)', spend: 0, impressions: 0, clicks: 0,
              conversions: Number(r.conversions || 0), conversionValue: Number(r.conversionValue || 0), revenue: Number(r.revenue || 0),
            }))
            rows.sort((a, b) => b.revenue - a.revenue) // entities returns ad-grain ordering; the store card ranks by revenue
            setData({ loading: false, error: null, hasCompare: false, rows: rows.slice(0, cfg.topN || 8) })
          })
          .catch(fail)
        return () => { alive = false }
      }
    }

    if (cfg.kind === 'stat') {
      const m = cfg.metric || 'spend'
      const p = new URLSearchParams({ clientId, ...winParams(current, compare) })
      fetch(`/api/next/client-metrics?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (!alive) return
          const priorKey = m === 'spend' ? 'spendPrior' : m === 'revenue' ? 'revenuePrior' : m === 'conversions' ? 'conversionsPrior' : m === 'clicks' ? 'clicksPrior' : m === 'impressions' ? 'impressionsPrior' : null
          setData({ loading: false, error: null, hasCompare: !!compare, statValue: num(d[m]), statCompare: compare && priorKey ? num(d[priorKey]) : null, incompleteNote: d.incompleteNote }) // LORAMER_QUERY_COMPLETENESS_V1 slice 2 — route-provided caption
        })
        .catch(fail)
    } else if (cfg.kind === 'breakdown') {
      const p = new URLSearchParams({ clientId, breakdownType: cfg.breakdownType || '', rankBy: cfg.rankBy || 'spend', topN: String(cfg.topN || 8), ...winParams(current, compare) })
      fetch(`/api/next/card-breakdown?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (!alive) return
          setData({ loading: false, error: null, hasCompare: !!compare, rows: Array.isArray(d.rows) ? d.rows : [], note: d.note })
        })
        .catch(fail)
    } else {
      if (alive) setData({ loading: false, error: null, hasCompare: !!compare })
    }
    return () => { alive = false }
  }, [clientId, cfg.kind, cfg.metric, cfg.breakdownType, cfg.rankBy, cfg.topN, cfg.source, cfg.storePlatform, current.startDate, current.endDate, cmpKey])

  return data
}
