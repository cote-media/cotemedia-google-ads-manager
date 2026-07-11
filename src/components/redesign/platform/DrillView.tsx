// LORAMER_NEXT_PLATFORM_PAGE_V1 — the drill orchestrator (ported from the legacy CampaignsTab drill wiring:
// drill state, Breadcrumb, browser pushState/popstate). Reads CAPTURED /api/next/entities per level (campaign →
// ad_group/ad_set → ad, filtered by parent_entity_id). A single `drill` state {depth, parents} avoids nested-setState;
// pushState carries {drillDepth, drillParents} so browser back/forward fully restore the drill. The summary is the
// level's TOTALS from entities (platform-scoped, accurate) — NOT portfolio CardEngine cards (which would mislead here).
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import DrillTable from './DrillTable'
import styles from './platform.module.css'

type Ent = { entityId: string; entityName: string; parentEntityId?: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; derived: Record<string, number> }
type Totals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; revenue: number; derived: Record<string, number> }
type Result = { rows: Ent[]; totals: Totals; entityCount: number }
type Drill = { depth: number; parents: { id: string; name: string }[] } // depth 0=campaign · parents[0]=campaign · parents[1]=middle

const levelsFor = (platform: string) => (platform === 'meta' ? ['campaign', 'ad_set', 'ad'] : ['campaign', 'ad_group', 'ad'])
const levelLabel = (platform: string, level: string) =>
  level === 'campaign' ? 'Campaign' : level === 'ad' ? 'Ad' : platform === 'meta' ? 'Ad Set' : 'Ad Group'

export default function DrillView({ platform, clientId, clientName, period }: { platform: string; clientId: string; clientName: string; period: string }) {
  const levels = levelsFor(platform)
  const [drill, setDrill] = useState<Drill>({ depth: 0, parents: [] })
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)

  const level = levels[drill.depth]
  const parentId = drill.depth === 0 ? undefined : drill.parents[drill.depth - 1]?.id

  // fetch the current level (parent-filtered) for the period — captured, membership-aware (resolveAccess in the route)
  useEffect(() => {
    const seq = ++reqSeq.current
    setLoading(true); setError(null)
    const p = new URLSearchParams({ clientId, platform, level, period })
    if (parentId) p.set('parentId', parentId)
    fetch(`/api/next/entities?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'no access' : 'HTTP ' + r.status))))
      .then((d) => { if (seq === reqSeq.current) { setData(d); setLoading(false) } })
      .catch((e) => { if (seq === reqSeq.current) { setError(String(e?.message || e)); setLoading(false) } })
  }, [clientId, platform, level, parentId, period])

  // drill DOWN: the clicked row becomes the parent of the next level; push a history entry (browser-back = up one).
  const drillInto = useCallback((row: Ent) => {
    setDrill((d) => {
      if (d.depth >= 2) return d // 'ad' is the leaf
      const parents = [...d.parents.slice(0, d.depth), { id: row.entityId, name: row.entityName }]
      const nd = { depth: d.depth + 1, parents }
      if (typeof window !== 'undefined') window.history.pushState({ drillDepth: nd.depth, drillParents: nd.parents }, '', window.location.href)
      return nd
    })
  }, [])
  const navigateTo = useCallback((depth: number) => setDrill((d) => ({ depth, parents: d.parents.slice(0, depth) })), [])

  // browser back/forward (and the explicit Back button via history.back()) restore the drill from the pushed state.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { drillDepth?: number; drillParents?: { id: string; name: string }[] } | null
      setDrill(st && typeof st.drillDepth === 'number' ? { depth: st.drillDepth, parents: st.drillParents || [] } : { depth: 0, parents: [] })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const nameLabel = levelLabel(platform, level)
  const STAT = [{ k: 'spend', l: 'Spend', money: true }, { k: 'clicks', l: 'Clicks', money: false }, { k: 'conversions', l: 'Conversions', money: false }, { k: 'roas', l: 'ROAS', money: false }]

  return (
    <div className={styles.drill}>
      {drill.depth > 0 && (
        <div className={styles.crumb}>
          <button className={styles.crumbBack} onClick={() => window.history.back()} aria-label="Back">← Back</button>
          <span className={styles.crumbSep}>·</span>
          <button className={styles.crumbLink} onClick={() => navigateTo(0)}>Campaigns</button>
          {drill.parents[0] && (<><span className={styles.crumbSep}>›</span>{drill.depth === 1 ? <span className={styles.crumbHere}>{drill.parents[0].name}</span> : <button className={styles.crumbLink} onClick={() => navigateTo(1)}>{drill.parents[0].name}</button>}</>)}
          {drill.parents[1] && drill.depth === 2 && (<><span className={styles.crumbSep}>›</span><span className={styles.crumbHere}>{drill.parents[1].name}</span></>)}
        </div>
      )}

      {data && (
        <div className={styles.stats}>
          {STAT.map((s) => {
            const v = s.k === 'roas' ? (data.totals.derived.roas ?? null) : ((data.totals as any)[s.k] as number)
            return <div key={s.k} className={styles.stat}><span className={styles.statLabel}>{s.l}</span><span className={styles.statVal}>{fmtStat(s.k, v, s.money)}</span></div>
          })}
        </div>
      )}

      {loading && <p className={styles.muted}>Loading…</p>}
      {error && <p className={styles.err}>Couldn’t load ({error}).</p>}
      {!loading && !error && data && data.entityCount === 0 && <p className={styles.muted}>No {nameLabel.toLowerCase()}s captured in this window.</p>}
      {!loading && !error && data && data.entityCount > 0 && (
        <DrillTable rows={data.rows} totals={data.totals} nameLabel={nameLabel} canDrill={drill.depth < 2} platform={platform} onDrill={drillInto} />
      )}
    </div>
  )
}

function fmtStat(k: string, v: number | null, money: boolean): string {
  if (v == null) return '—'
  if (k === 'roas') return v.toFixed(2) + '×'
  if (money) return '$' + Math.round(v).toLocaleString('en-US')
  return Math.round(v).toLocaleString('en-US')
}
