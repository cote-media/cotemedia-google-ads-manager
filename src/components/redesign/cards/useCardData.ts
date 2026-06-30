// LORAMER_NEXT_CARD_ENGINE_V1 — the ONE data hook for every card. Dispatches by kind to OWNER-GATED -next routes
// (the routes run resolveAccess: layout keys off the VIEWER, data off the OWNER). HONEST states: distinguishes
// loading / error ("couldn't load") / empty ("no data") — never a fabricated zero. timeseries cards render the
// existing CombinedPerformanceChart directly (its own route), so this hook handles stat + breakdown only.
'use client'
import { useEffect, useState } from 'react'
import type { CardConfig } from './card-types'

export interface BreakdownRow { value: string; spend: number; conversions: number; conversionValue: number; impressions: number; clicks: number; revenue: number }
export interface CardData {
  loading: boolean
  error: string | null      // non-null = couldn't load (show the message, NOT a zero)
  // stat:
  statValue?: number | null
  statPrior?: number | null
  statMoney?: boolean
  statSuffix?: string
  // breakdown:
  rows?: BreakdownRow[]
  note?: string             // e.g. "coming soon" for a not-yet-exposed family
}

const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

export function useCardData(clientId: string, cfg: CardConfig): CardData {
  const [data, setData] = useState<CardData>({ loading: true, error: null })

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setData({ loading: true, error: null })

    const fail = () => { if (alive) setData({ loading: false, error: 'Couldn’t load' }) }

    if (cfg.kind === 'stat') {
      fetch(`/api/next/client-metrics?clientId=${encodeURIComponent(clientId)}&period=${encodeURIComponent(cfg.dateRange)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (!alive) return
          const m = cfg.metric || 'spend'
          const priorKey = m === 'spend' ? 'spendPrior' : m === 'revenue' ? 'revenuePrior' : m === 'conversions' ? 'conversionsPrior' : m === 'clicks' ? 'clicksPrior' : m === 'impressions' ? 'impressionsPrior' : null
          setData({
            loading: false, error: null,
            statValue: num(d[m]),
            statPrior: priorKey ? num(d[priorKey]) : null,
            statMoney: m === 'spend' || m === 'revenue',
            statSuffix: m === 'roas' ? 'x' : undefined,
          })
        })
        .catch(fail)
    } else if (cfg.kind === 'breakdown') {
      const p = new URLSearchParams({ clientId, breakdownType: cfg.breakdownType || '', period: cfg.dateRange, rankBy: cfg.rankBy || 'spend', topN: String(cfg.topN || 8) })
      fetch(`/api/next/card-breakdown?${p.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (!alive) return
          setData({ loading: false, error: null, rows: Array.isArray(d.rows) ? d.rows : [], note: d.note })
        })
        .catch(fail)
    } else {
      // timeseries handled by the card body component directly; nothing to fetch here.
      if (alive) setData({ loading: false, error: null })
    }

    return () => { alive = false }
  }, [clientId, cfg.kind, cfg.metric, cfg.breakdownType, cfg.dateRange, cfg.rankBy, cfg.topN])

  return data
}
