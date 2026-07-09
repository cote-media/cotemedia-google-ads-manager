// LORAMER_NEXT_CARD_ENGINE_V1 / _RESHAPE_V1 — the ONE data hook for every card. Dispatches by kind to OWNER-GATED
// -next routes. Takes the RESOLVED current window + optional compare window (the engine resolves global-vs-override
// + the page compare mode and passes explicit dates). Returns current value + the compare-window value (for deltas).
// HONEST states: loading / error ("couldn't load") / empty ("no data") — never a fabricated zero. timeseries cards
// render their own chart (CombinedPerformanceChart / CompareLine), so this hook handles stat + breakdown only.
'use client'
import { useEffect, useState } from 'react'
import type { CardConfig } from './card-types'
import type { Win } from '@/lib/next/card-windows'

export interface BreakdownRow { value: string; spend: number; conversions: number; conversionValue: number; impressions: number; clicks: number; revenue: number; metaRoas?: number | null; cmpRank?: number } // metaRoas: LORAMER_META_CONV_ACTION_VALUE_ROAS_V1 — Meta-reported ROAS, present only on the canonicalized action_type card rows
export interface CardData {
  loading: boolean
  error: string | null
  hasCompare: boolean
  statValue?: number | null
  statCompare?: number | null
  rows?: BreakdownRow[]
  note?: string
}

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }
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

    if (cfg.kind === 'stat') {
      const m = cfg.metric || 'spend'
      const p = new URLSearchParams({ clientId, ...winParams(current, compare) })
      fetch(`/api/next/client-metrics?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (!alive) return
          const priorKey = m === 'spend' ? 'spendPrior' : m === 'revenue' ? 'revenuePrior' : m === 'conversions' ? 'conversionsPrior' : m === 'clicks' ? 'clicksPrior' : m === 'impressions' ? 'impressionsPrior' : null
          setData({ loading: false, error: null, hasCompare: !!compare, statValue: num(d[m]), statCompare: compare && priorKey ? num(d[priorKey]) : null })
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
  }, [clientId, cfg.kind, cfg.metric, cfg.breakdownType, cfg.rankBy, cfg.topN, current.startDate, current.endDate, cmpKey])

  return data
}
