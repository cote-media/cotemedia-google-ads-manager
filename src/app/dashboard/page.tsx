'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { Campaign, PlatformData, Platform, CampaignStatus } from '@/lib/platforms/types'
import { COLUMN_DEFS, statusLabel, statusBadgeClass } from '@/lib/platforms/types'

const DATE_RANGES = [
  { label: 'Today', value: 'TODAY' },
  { label: 'Yesterday', value: 'YESTERDAY' },
  { label: 'Last 7 days', value: 'LAST_7_DAYS' },
  { label: 'Last 14 days', value: 'LAST_14_DAYS' },
  { label: 'Last 30 days', value: 'LAST_30_DAYS' },
  { label: 'This month', value: 'THIS_MONTH' },
  { label: 'Last month', value: 'LAST_MONTH' },
  { label: 'Last 90 days', value: 'LAST_90_DAYS' },
  { label: 'Custom range', value: 'CUSTOM' },
]

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'campaigns', label: 'Campaigns', icon: '◈' },
  { id: 'keywords', label: 'Keywords', icon: '⌖', googleOnly: true },
  { id: 'chat', label: 'Ask Claude', icon: '✦' },
]

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea',
  '#0891b2', '#dc2626', '#ca8a04', '#db2777',
  '#65a30d', '#7c3aed',
]

type Client = {
  id: string
  name: string
  platform_connections: { id: string; platform: string; account_id: string; account_name: string }[]
}

type DrillLevel = 'campaigns' | 'adgroups' | 'ads'
type DrillState = {
  level: DrillLevel
  campaign: { id: string; name: string; platform: 'google' | 'meta' } | null
  adGroup: { id: string; name: string } | null
}

function ls(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, val: string) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, val) } catch {}
}
function lsJson<T>(key: string, fallback: T): T {
  try { const v = ls(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}

function fmt(n: number | null | undefined, type: 'currency' | 'number' | 'percent' | 'decimal' | 'multiplier' = 'number'): string {
  if (n === null || n === undefined) return '—'
  if (type === 'currency') return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (type === 'percent') return n.toFixed(2) + '%'
  if (type === 'decimal') return n.toFixed(2)
  if (type === 'multiplier') return n.toFixed(2) + 'x'
  return n.toLocaleString()
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={statusBadgeClass(status)}>● {statusLabel(status)}</span>
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center">
      <div className="text-center">
        <div className="w-1 h-8 bg-ink animate-pulse mx-auto mb-4" />
        <p className="font-mono text-xs text-muted tracking-widest uppercase">Loading</p>
      </div>
    </div>
  )
}

// ─── Column Picker ────────────────────────────────────────────────────────────
function ColumnPicker({ platform, active, onChange }: {
  platform: Platform; active: string[]; onChange: (cols: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const available = COLUMN_DEFS.filter(c => c.platforms.includes(platform))
  const categories = [
    { id: 'core', label: 'Core Metrics' },
    { id: 'ecommerce', label: 'E-Commerce' },
    { id: 'meta', label: 'Meta Only' },
    { id: 'google', label: 'Google Only' },
  ]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">
        ⊞ Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-56 max-h-96 overflow-y-auto">
          {categories.map(cat => {
            const cols = available.filter(c => c.category === cat.id)
            if (cols.length === 0) return null
            return (
              <div key={cat.id} className="mb-3">
                <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">{cat.label}</p>
                {cols.map(col => (
                  <label key={col.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
                    <input type="checkbox" checked={active.includes(col.id)}
                      onChange={e => { if (e.target.checked) onChange([...active, col.id]); else onChange(active.filter(c => c !== col.id)) }}
                      className="accent-accent" />
                    <span className="text-xs text-ink">{col.label}</span>
                  </label>
                ))}
              </div>
            )
          })}
          <button onClick={() => setOpen(false)} className="mt-2 text-xs text-muted hover:text-ink font-mono border-t border-border pt-2 w-full text-left">Done</button>
        </div>
      )}
    </div>
  )
}

// ─── Google Chart ─────────────────────────────────────────────────────────────
const GOOGLE_METRICS = [
  { id: 'cost', label: 'Spend', color: '#2563eb' },
  { id: 'clicks', label: 'Clicks', color: '#16a34a' },
  { id: 'impressions', label: 'Impressions', color: '#9333ea' },
  { id: 'conversions', label: 'Conversions', color: '#ea580c' },
]

function GoogleChart({ accountId, dateRange, campaignId, campaignName, customStart, customEnd }: {
  accountId: string; dateRange: string; campaignId?: string; campaignName?: string; customStart?: string; customEnd?: string
}) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['cost', 'clicks'])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')

  useEffect(() => {
    setLoading(true)
    let url = '/api/daily?accountId=' + accountId + '&dateRange=' + dateRange + '&granularity=' + granularity
    if (campaignId) url += '&campaignId=' + campaignId
    if (customStart) url += '&customStart=' + customStart
    if (customEnd) url += '&customEnd=' + customEnd
    fetch(url).then(r => r.json()).then(d => {
      setData((d.daily || []).map((row: any) => ({ ...row, date: String(row.date).slice(5) })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [accountId, dateRange, campaignId, granularity, customStart, customEnd])

  const toggle = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])
  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!data.length) return null

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Performance Over Time</h3>
          {campaignName && <p className="text-xs text-accent font-mono mt-0.5">{campaignName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-border">
            {(['day', 'week', 'month'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                className={'text-xs font-mono px-2 py-1 transition-colors ' + (granularity === g ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap">
            {GOOGLE_METRICS.map(m => (
              <button key={m.id} onClick={() => toggle(m.id)}
                className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetrics.includes(m.id) ? 'text-white border-transparent' : 'text-muted border-border hover:text-ink')}
                style={activeMetrics.includes(m.id) ? { backgroundColor: m.color, borderColor: m.color } : {}}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 0 }} />
          {GOOGLE_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Meta Chart ───────────────────────────────────────────────────────────────
const META_METRICS = [
  { id: 'cost', label: 'Spend', color: '#0ea5e9' },
  { id: 'clicks', label: 'Clicks', color: '#10b981' },
  { id: 'impressions', label: 'Impressions', color: '#8b5cf6' },
  { id: 'conversions', label: 'Conversions', color: '#f97316' },
]

function MetaChart({ accountId, dateRange, campaignId, campaignName, customStart, customEnd }: {
  accountId: string; dateRange: string; campaignId?: string; campaignName?: string; customStart?: string; customEnd?: string
}) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['cost', 'clicks'])

  useEffect(() => {
    setLoading(true)
    let url = '/api/meta/daily?accountId=' + accountId + '&dateRange=' + dateRange
    if (campaignId) url += '&campaignId=' + campaignId
    if (customStart) url += '&customStart=' + customStart
    if (customEnd) url += '&customEnd=' + customEnd
    fetch(url).then(r => r.json()).then(d => {
      setData((d.daily || []).map((row: any) => ({ ...row, date: String(row.date).slice(5) })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [accountId, dateRange, campaignId, customStart, customEnd])

  const toggle = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])
  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!data.length) return null

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Performance Over Time</h3>
          {campaignName && <p className="text-xs text-accent font-mono mt-0.5">{campaignName}</p>}
        </div>
        <div className="flex gap-1 flex-wrap">
          {META_METRICS.map(m => (
            <button key={m.id} onClick={() => toggle(m.id)}
              className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetrics.includes(m.id) ? 'text-white border-transparent' : 'text-muted border-border hover:text-ink')}
              style={activeMetrics.includes(m.id) ? { backgroundColor: m.color, borderColor: m.color } : {}}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 0 }} />
          {META_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Combined Chart ───────────────────────────────────────────────────────────
function CombinedChart({ googleAccountId, metaAccountId, dateRange, customStart, customEnd }: {
  googleAccountId: string; metaAccountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const [googleData, setGoogleData] = useState<any[]>([])
  const [metaData, setMetaData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['cost'])

  useEffect(() => {
    setLoading(true)
    const base = (customStart ? '&customStart=' + customStart : '') + (customEnd ? '&customEnd=' + customEnd : '')
    Promise.all([
      fetch('/api/daily?accountId=' + googleAccountId + '&dateRange=' + dateRange + base).then(r => r.json()),
      fetch('/api/meta/daily?accountId=' + metaAccountId + '&dateRange=' + dateRange + base).then(r => r.json()),
    ]).then(([gd, md]) => {
      setGoogleData((gd.daily || []).map((r: any) => ({ date: String(r.date).slice(5), google_cost: r.cost, google_clicks: r.clicks, google_conversions: r.conversions })))
      setMetaData((md.daily || []).map((r: any) => ({ date: String(r.date).slice(5), meta_cost: r.cost, meta_clicks: r.clicks, meta_conversions: r.conversions })))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [googleAccountId, metaAccountId, dateRange, customStart, customEnd])

  const merged = (() => {
    const map: Record<string, any> = {}
    googleData.forEach(r => { map[r.date] = { ...map[r.date], date: r.date, google_cost: r.google_cost, google_clicks: r.google_clicks, google_conversions: r.google_conversions } })
    metaData.forEach(r => { map[r.date] = { ...map[r.date], date: r.date, meta_cost: r.meta_cost, meta_clicks: r.meta_clicks, meta_conversions: r.meta_conversions } })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  })()

  const COMBINED_METRICS = [
    { id: 'cost', label: 'Spend', googleKey: 'google_cost', metaKey: 'meta_cost', googleColor: '#2563eb', metaColor: '#0ea5e9' },
    { id: 'clicks', label: 'Clicks', googleKey: 'google_clicks', metaKey: 'meta_clicks', googleColor: '#16a34a', metaColor: '#10b981' },
    { id: 'conversions', label: 'Conversions', googleKey: 'google_conversions', metaKey: 'meta_conversions', googleColor: '#ea580c', metaColor: '#f97316' },
  ]

  const toggle = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])
  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!merged.length) return null

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Combined Performance</h3>
          <p className="text-xs text-muted font-mono mt-0.5">🔵 Google (solid) · 🔷 Meta (dashed)</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {COMBINED_METRICS.map(m => (
            <button key={m.id} onClick={() => toggle(m.id)}
              className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetrics.includes(m.id) ? 'bg-ink text-white border-ink' : 'text-muted border-border hover:text-ink')}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 0 }} />
          {COMBINED_METRICS.filter(m => activeMetrics.includes(m.id)).flatMap(m => [
            <Line key={m.id + '_g'} type="monotone" dataKey={m.googleKey} stroke={m.googleColor} strokeWidth={2} dot={false} name={'🔵 ' + m.label} />,
            <Line key={m.id + '_m'} type="monotone" dataKey={m.metaKey} stroke={m.metaColor} strokeWidth={2} dot={false} strokeDasharray="4 2" name={'🔷 ' + m.label} />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Ad Group Multi-line Chart ────────────────────────────────────────────────
function AdGroupChart({ campaignId, accountId, dateRange, platform, metaAccountId, customStart, customEnd }: {
  campaignId: string; accountId: string; dateRange: string; platform: Platform; metaAccountId?: string; customStart?: string; customEnd?: string
}) {
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [activeMetric, setActiveMetric] = useState<'cost' | 'clicks' | 'impressions' | 'conversions'>('cost')
  const [series, setSeries] = useState<{ id: string; name: string; spend: number; daily: any[] }[]>([])
  const [loading, setLoading] = useState(true)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())

  const metricLabels = { cost: 'Spend', clicks: 'Clicks', impressions: 'Impressions', conversions: 'Conversions' }
  const metricColors = { cost: '#2563eb', clicks: '#16a34a', impressions: '#9333ea', conversions: '#ea580c' }

  useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    const base = (customStart ? '&customStart=' + customStart : '') + (customEnd ? '&customEnd=' + customEnd : '')

    const load = async () => {
      if (platform === 'google') {
        const res = await fetch('/api/google/adgroups/daily?accountId=' + accountId + '&campaignId=' + campaignId + '&dateRange=' + dateRange + '&granularity=' + granularity + base)
        const d = await res.json()
        const s = (d.adGroups || []).map((ag: any) => ({
          id: ag.id, name: ag.name,
          spend: ag.daily.reduce((t: number, r: any) => t + (r.cost || 0), 0),
          daily: ag.daily.map((r: any) => ({ ...r, date: String(r.date).slice(5) })),
        })).sort((a: any, b: any) => b.spend - a.spend)
        setSeries(s)
        setVisibleIds(new Set(s.slice(0, 5).map((x: any) => x.id)))
      } else if (platform === 'meta' && metaAccountId) {
        const asRes = await fetch('/api/meta/adsets?campaignId=' + campaignId + '&dateRange=' + dateRange + base)
        const asData = await asRes.json()
        const adSets = asData.adSets || []
        const withDaily = await Promise.all(adSets.map(async (as: any) => {
          const dRes = await fetch('/api/meta/daily?accountId=' + metaAccountId + '&campaignId=' + as.id + '&dateRange=' + dateRange + base)
          const dd = await dRes.json()
          return { id: as.id, name: as.name, spend: as.spend || 0, daily: (dd.daily || []).map((r: any) => ({ ...r, date: String(r.date).slice(5) })) }
        }))
        const sorted = withDaily.sort((a, b) => b.spend - a.spend)
        setSeries(sorted)
        setVisibleIds(new Set(sorted.slice(0, 5).map(x => x.id)))
      }
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [campaignId, accountId, dateRange, granularity, platform, metaAccountId, customStart, customEnd])

  const colorMap: Record<string, string> = {}
  series.forEach((s, i) => { colorMap[s.id] = CHART_COLORS[i % CHART_COLORS.length] })

  const merged = (() => {
    const map: Record<string, any> = {}
    series.filter(s => visibleIds.has(s.id)).forEach(s => {
      s.daily.forEach((row: any) => {
        if (!map[row.date]) map[row.date] = { date: row.date }
        map[row.date][s.id] = row[activeMetric] ?? 0
      })
    })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  })()

  const toggleV = (id: string) => setVisibleIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) { if (next.size > 1) next.delete(id) } else next.add(id)
    return next
  })

  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!series.length) return null

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {platform === 'google' && (
            <div className="flex border border-border">
              {(['day', 'week', 'month'] as const).map(g => (
                <button key={g} onClick={() => setGranularity(g)}
                  className={'text-xs font-mono px-2 py-1 transition-colors ' + (granularity === g ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            {(Object.keys(metricLabels) as Array<keyof typeof metricLabels>).map(m => (
              <button key={m} onClick={() => setActiveMetric(m)}
                className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetric === m ? 'text-white border-transparent' : 'text-muted border-border hover:text-ink')}
                style={activeMetric === m ? { backgroundColor: metricColors[m], borderColor: metricColors[m] } : {}}>
                {metricLabels[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {series.map(s => {
            const on = visibleIds.has(s.id)
            const color = colorMap[s.id]
            return (
              <button key={s.id} onClick={() => toggleV(s.id)}
                className={'flex items-center gap-1.5 text-xs font-mono px-2 py-1 border rounded-full transition-all ' + (on ? 'text-white' : 'text-muted border-border')}
                style={on ? { backgroundColor: color, borderColor: color } : { borderColor: color }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate max-w-[100px]">{s.name}</span>
                <span className="opacity-70">${s.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </button>
            )
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 11, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 0 }} />
          {series.filter(s => visibleIds.has(s.id)).map(s => (
            <Line key={s.id} type="monotone" dataKey={s.id} stroke={colorMap[s.id]} strokeWidth={2} dot={false} name={s.name} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Ad Bar Chart ─────────────────────────────────────────────────────────────
function AdBarChart({ ads }: { ads: any[] }) {
  const [activeMetric, setActiveMetric] = useState<'spend' | 'clicks' | 'conversions' | 'ctr'>('spend')
  const metricColors = { spend: '#2563eb', clicks: '#16a34a', conversions: '#ea580c', ctr: '#9333ea' }
  const metricLabels = { spend: 'Spend', clicks: 'Clicks', conversions: 'Conversions', ctr: 'CTR' }
  if (!ads.length) return null
  const chartData = [...ads].sort((a, b) => (b[activeMetric] || 0) - (a[activeMetric] || 0)).slice(0, 10)
    .map(ad => ({ name: (ad.name || 'Ad').slice(0, 35), value: ad[activeMetric] || 0 }))
  const max = chartData[0]?.value || 1
  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Ad Performance</h3>
        <div className="flex gap-1">
          {(Object.keys(metricLabels) as Array<keyof typeof metricLabels>).map(m => (
            <button key={m} onClick={() => setActiveMetric(m)}
              className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetric === m ? 'text-white border-transparent' : 'text-muted border-border hover:text-ink')}
              style={activeMetric === m ? { backgroundColor: metricColors[m], borderColor: metricColors[m] } : {}}>
              {metricLabels[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {chartData.map((d, i) => {
          const pct = (d.value / max) * 100
          const fv = activeMetric === 'spend' ? fmt(d.value, 'currency') : activeMetric === 'ctr' ? fmt(d.value, 'percent') : d.value.toLocaleString(undefined, { maximumFractionDigits: 1 })
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs text-ink truncate max-w-[70%]">{d.name}</span>
                <span className="text-xs font-mono text-muted">{fv}</span>
              </div>
              <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: metricColors[activeMetric] }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Drill Table ──────────────────────────────────────────────────────────────
function DrillTable({ rows, level, platform, activeCols, onRowClick }: {
  rows: any[]; level: DrillLevel; platform: Platform; activeCols: string[]; onRowClick: (row: any) => void
}) {
  const [sortCol, setSortCol] = useState('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const visibleCols = COLUMN_DEFS.filter(c => c.platforms.includes(platform) && activeCols.includes(c.id))

  const sorted = [...rows].sort((a, b) => {
    const col = COLUMN_DEFS.find(c => c.id === sortCol)
    if (!col) return 0
    const av = Number(col.getValue(a) ?? 0)
    const bv = Number(col.getValue(b) ?? 0)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  function handleSort(id: string) {
    if (sortCol === id) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(id); setSortDir('desc') }
  }

  const totals = {
    spend: rows.reduce((s, r) => s + (r.spend || 0), 0),
    clicks: rows.reduce((s, r) => s + (r.clicks || 0), 0),
    impressions: rows.reduce((s, r) => s + (r.impressions || 0), 0),
    conversions: rows.reduce((s, r) => s + (r.conversions || 0), 0),
    conversionValue: rows.reduce((s, r) => s + (r.conversionValue || 0), 0),
  }
  const tCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  const tRoas = totals.spend > 0 && totals.conversionValue > 0 ? totals.conversionValue / totals.spend : null
  const tCpc = totals.clicks > 0 ? totals.spend / totals.clicks : null
  const tCpa = totals.conversions > 0 ? totals.spend / totals.conversions : null

  function getTotalValue(colId: string): string {
    switch (colId) {
      case 'spend': return fmt(totals.spend, 'currency')
      case 'clicks': return fmt(totals.clicks)
      case 'impressions': return fmt(totals.impressions)
      case 'conversions': return fmt(totals.conversions, 'decimal')
      case 'ctr': return fmt(tCtr, 'percent')
      case 'roas': return tRoas ? fmt(tRoas, 'multiplier') : '—'
      case 'costPerConv': return tCpa ? fmt(tCpa, 'currency') : '—'
      case 'avgCpc': return tCpc ? fmt(tCpc, 'currency') : '—'
      case 'convRate': return totals.clicks > 0 ? fmt((totals.conversions / totals.clicks) * 100, 'percent') : '—'
      default: return '—'
    }
  }

  function formatValue(colId: string, val: any): string {
    if (val === null || val === undefined) return '—'
    const n = Number(val)
    const currCols = ['spend', 'costPerConv', 'avgCpc', 'cpm', 'budget', 'costPerAddToCart', 'costPerInitiateCheckout', 'costPerPurchase']
    if (currCols.includes(colId)) return fmt(n, 'currency')
    if (['ctr', 'convRate'].includes(colId)) return fmt(n, 'percent')
    if (['roas'].includes(colId)) return fmt(n, 'multiplier')
    if (['frequency'].includes(colId)) return n.toFixed(2)
    if (['clicks', 'impressions', 'reach', 'addToCart', 'initiateCheckout', 'purchases', 'viewContent', 'addToWishlist'].includes(colId)) return fmt(n)
    if (['conversions'].includes(colId)) return n.toFixed(1)
    return String(val)
  }

  const isClickable = level !== 'ads'
  const nameLabel = level === 'campaigns' ? 'Campaign' : level === 'adgroups' ? (platform === 'meta' ? 'Ad Set' : 'Ad Group') : 'Ad'

  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface">{nameLabel}</th>
            {platform === 'combined' && level === 'campaigns' && <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Platform</th>}
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Status</th>
            {level === 'ads' && <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider hidden md:table-cell">Copy</th>}
            {visibleCols.map(col => (
              <th key={col.id} onClick={() => handleSort(col.id)}
                className="text-right px-3 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none whitespace-nowrap">
                {col.label}{sortCol === col.id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
            {isClickable && <th className="px-3 py-3 w-6" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row: any) => (
            <tr key={row.id + (row.platform || '')}
              onClick={() => isClickable && onRowClick(row)}
              className={'table-row ' + (isClickable ? 'cursor-pointer hover:bg-surface' : '')}>
              <td className="px-3 py-3 font-medium max-w-xs truncate sticky left-0 bg-white">{row.name}</td>
              {platform === 'combined' && level === 'campaigns' && (
                <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-muted">{row.platform === 'google' ? '🔵' : '🔷'}</td>
              )}
              <td className="px-3 py-3 whitespace-nowrap"><StatusBadge status={row.status} /></td>
              {level === 'ads' && <td className="px-3 py-3 text-xs text-muted max-w-xs truncate hidden md:table-cell">{row.description || row.body || ''}</td>}
              {visibleCols.map(col => (
                <td key={col.id} className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
                  {formatValue(col.id, col.getValue(row))}
                </td>
              ))}
              {isClickable && <td className="px-3 py-3 text-right text-muted text-xs">›</td>}
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-border bg-surface font-medium">
              <td className="px-3 py-3 font-mono text-xs text-muted sticky left-0 bg-surface">Total</td>
              {platform === 'combined' && level === 'campaigns' && <td className="px-3 py-3" />}
              <td className="px-3 py-3" />
              {level === 'ads' && <td className="px-3 py-3 hidden md:table-cell" />}
              {visibleCols.map(col => (
                <td key={col.id} className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap text-ink">
                  {getTotalValue(col.id)}
                </td>
              ))}
              {isClickable && <td className="px-3 py-3" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────
function Breadcrumb({ drill, onNavigate }: { drill: DrillState; onNavigate: (level: DrillLevel) => void }) {
  if (drill.level === 'campaigns') return null
  return (
    <div className="flex items-center gap-2 mb-4 text-xs font-mono flex-wrap">
      <button onClick={() => onNavigate('campaigns')} className="text-accent hover:underline">Campaigns</button>
      {drill.campaign && (
        <>
          <span className="text-muted">›</span>
          {drill.level === 'adgroups'
            ? <span className="text-ink font-medium truncate max-w-xs">{drill.campaign.name}</span>
            : <button onClick={() => onNavigate('adgroups')} className="text-accent hover:underline truncate max-w-xs">{drill.campaign.name}</button>
          }
        </>
      )}
      {drill.adGroup && drill.level === 'ads' && (
        <>
          <span className="text-muted">›</span>
          <span className="text-muted">{drill.campaign?.platform === 'meta' ? 'Ad Sets' : 'Ad Groups'}</span>
          <span className="text-muted">›</span>
          <span className="text-ink font-medium truncate max-w-xs">{drill.adGroup.name}</span>
        </>
      )}
    </div>
  )
}

// ─── Insight Banner with Claude ───────────────────────────────────────────────
function InsightBanner({ data, clientName, dateRange }: { data: PlatformData; clientName: string; dateRange: string }) {
  const { totals, campaigns, platform } = data
  const cacheKey = 'advar-insight-' + clientName + '-' + platform + '-' + dateRange
  const [insight, setInsight] = useState<string>(() => {
    try {
      const cached = lsJson(cacheKey, null) as any
      if (cached && cached.text && cached.ts && (Date.now() - cached.ts) < 3600000) return cached.text
    } catch {}
    return ''
  })
  const [loading, setLoading] = useState(!insight)

  // Anomaly detection (always run, used as fallback)
  const anomalies: string[] = []
  if (totals.roas !== null && totals.roas < 0.5 && totals.spend > 100) anomalies.push('ROAS is critically low at ' + fmt(totals.roas, 'multiplier'))
  const pausedWithSpend = campaigns.filter(c => c.status === 'paused' && c.spend > 0)
  if (pausedWithSpend.length > 0) anomalies.push(pausedWithSpend.length + ' paused campaign(s) recorded spend')
  const hasAnomalies = anomalies.length > 0

  useEffect(() => {
    // Always fetch fresh insight in background (show cached immediately)
    fetch('/api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totals, campaigns, platform, dateRange, clientName }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.insight) {
          setInsight(d.insight)
          lsSet(cacheKey, JSON.stringify({ text: d.insight, ts: Date.now() }))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [clientName, platform, dateRange])

  if (hasAnomalies) {
    return (
      <div className="border px-4 md:px-6 py-4 md:py-5 bg-amber-50 border-amber-300">
        <p className="font-mono text-xs uppercase tracking-widest mb-2 text-amber-600">⚠ Attention needed</p>
        <div className="space-y-1">{anomalies.map((a, i) => <p key={i} className="text-sm text-amber-800 font-medium">• {a}</p>)}</div>
      </div>
    )
  }

  return (
    <div className="border px-4 md:px-6 py-4 md:py-5 bg-blue-50 border-blue-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-mono text-xs uppercase tracking-widest mb-2 text-accent">✦ Claude Analysis</p>
          {loading && !insight ? (
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
              <span className="text-sm text-muted font-mono">Analyzing account...</span>
            </div>
          ) : (
            <p className="text-sm text-ink leading-relaxed">{insight}</p>
          )}
        </div>
        {loading && insight && <span className="text-xs font-mono text-muted ml-4 flex-shrink-0 animate-pulse">Refreshing...</span>}
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ data, googleAccountId, metaAccountId, dateRange, clientName, customStart, customEnd }: {
  data: PlatformData; googleAccountId: string; metaAccountId: string; dateRange: string; clientName: string; customStart?: string; customEnd?: string
}) {
  const { totals, campaigns, platform } = data
  const metrics = [
    { label: 'Total Spend', value: fmt(totals.spend, 'currency') },
    { label: 'Clicks', value: fmt(totals.clicks) },
    { label: 'Impressions', value: fmt(totals.impressions) },
    { label: 'Conversions', value: fmt(totals.conversions, 'decimal') },
    { label: 'ROAS', value: totals.roas ? fmt(totals.roas, 'multiplier') : '—' },
    { label: 'Avg CTR', value: fmt(totals.avgCtr, 'percent') },
  ]
  const topByCost = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5)
  const topByConv = [...campaigns].filter(c => c.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 5)
  const maxCost = topByCost.length > 0 ? topByCost[0].spend : 1
  const campaignsWithBudget = campaigns.filter(c => c.budget && c.budget > 0).slice(0, 5)

  return (
    <div className="space-y-4 md:space-y-6">
      <InsightBanner data={data} clientName={clientName} dateRange={dateRange} />

      {platform === 'combined' && totals.googleSpend !== undefined && totals.metaSpend !== undefined && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-border p-4">
            <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">🔵 Google Ads</p>
            <p className="text-2xl font-display text-accent">{fmt(totals.googleSpend, 'currency')}</p>
          </div>
          <div className="bg-white border border-border p-4">
            <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">🔷 Meta Ads</p>
            <p className="text-2xl font-display text-accent">{fmt(totals.metaSpend, 'currency')}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="metric-label mb-1 md:mb-2 text-xs">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>

      {platform === 'google' && googleAccountId && <GoogleChart accountId={googleAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {platform === 'meta' && metaAccountId && <MetaChart accountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {platform === 'combined' && googleAccountId && metaAccountId && <CombinedChart googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Campaign Performance</h3>
          <div className="space-y-3">
            {topByCost.map(c => (
              <div key={c.id + c.platform}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink truncate max-w-[65%]">
                    {platform === 'combined' && <span className="mr-1">{c.platform === 'google' ? '🔵' : '🔷'}</span>}
                    {c.name}
                  </span>
                  <span className="text-xs font-mono text-muted">{fmt(c.spend, 'currency')}</span>
                </div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: (c.spend / maxCost * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Conversion Leaders</h3>
          {topByConv.length === 0 ? <p className="text-xs text-muted font-mono">No conversions recorded</p> : (
            <div className="space-y-2">
              {topByConv.map(c => (
                <div key={c.id + c.platform} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <span className="text-xs text-ink truncate max-w-[55%]">
                    {platform === 'combined' && <span className="mr-1">{c.platform === 'google' ? '🔵' : '🔷'}</span>}
                    {c.name}
                  </span>
                  <div className="text-right">
                    <span className="text-xs font-mono text-accent font-medium">{c.conversions.toFixed(1)} conv</span>
                    {c.costPerConv && <span className="text-xs font-mono text-muted ml-2">{fmt(c.costPerConv, 'currency')}/conv</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {platform === 'google' && googleAccountId && (
          <div className="bg-white border border-border p-4 md:p-5">
            <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Top Keywords by Spend</h3>
            <TopKeywordsCard accountId={googleAccountId} dateRange={dateRange} />
          </div>
        )}
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Budget Utilization</h3>
          {campaignsWithBudget.length === 0 ? <p className="text-xs text-muted font-mono">No budget data available</p> : (
            <div className="space-y-3">
              {campaignsWithBudget.map(c => {
                const pct = Math.min((c.spend / (c.budget! * 30)) * 100, 100)
                const barColor = pct > 90 ? '#dc2626' : pct > 70 ? '#f59e0b' : '#2563eb'
                return (
                  <div key={c.id + c.platform}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-ink truncate max-w-[60%]">{c.name}</span>
                      <span className="text-xs font-mono text-muted">{fmt(c.budget!, 'currency')}/day</span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: barColor }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TopKeywordsCard({ accountId, dateRange }: { accountId: string; dateRange: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json()).then(d => { setKeywords((d.keywords || []).slice(0, 5)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, dateRange])
  if (loading) return <p className="text-xs text-muted font-mono">Loading...</p>
  if (!keywords.length) return <p className="text-xs text-muted font-mono">No keyword data</p>
  return (
    <div className="space-y-2">
      {keywords.map((k: any, i: number) => (
        <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
          <span className="text-xs text-ink truncate max-w-[60%]">{k.text}</span>
          <span className="text-xs font-mono text-muted">${k.cost}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Campaigns Tab with Drill-down ────────────────────────────────────────────
function CampaignsTab({ data, googleAccountId, metaAccountId, dateRange, customStart, customEnd }: {
  data: PlatformData; googleAccountId: string; metaAccountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const { campaigns, platform } = data
  const storageKey = 'advar-cols-' + platform
  const defaultCols = COLUMN_DEFS.filter(c => c.platforms.includes(platform) && c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => lsJson(storageKey, defaultCols))

  const [drill, setDrill] = useState<DrillState>(() => lsJson('advar-drill-state', { level: 'campaigns', campaign: null, adGroup: null }))
  const [subRows, setSubRows] = useState<any[]>([])
  const [subLoading, setSubLoading] = useState(false)

  function saveDrill(d: DrillState) {
    setDrill(d)
    lsSet('advar-drill-state', JSON.stringify(d))
  }

  const updateCols = (cols: string[]) => { setActiveCols(cols); lsSet(storageKey, JSON.stringify(cols)) }

  async function drillIntoCampaign(campaign: any) {
    const campaignPlatform: 'google' | 'meta' = campaign.platform || (platform === 'combined' ? 'google' : platform as 'google' | 'meta')
    const newDrill: DrillState = { level: 'adgroups', campaign: { id: campaign.id, name: campaign.name, platform: campaignPlatform }, adGroup: null }
    saveDrill(newDrill)
    setSubLoading(true)
    setSubRows([])
    try {
      const base = (customStart ? '&customStart=' + customStart : '') + (customEnd ? '&customEnd=' + customEnd : '')
      if (campaignPlatform === 'google') {
        const res = await fetch('/api/google/adgroups?accountId=' + googleAccountId + '&campaignId=' + campaign.id + '&dateRange=' + dateRange + base)
        const d = await res.json()
        setSubRows(d.adGroups || [])
      } else if (campaignPlatform === 'meta') {
        const res = await fetch('/api/meta/adsets?campaignId=' + campaign.id + '&dateRange=' + dateRange + base)
        const d = await res.json()
        setSubRows(d.adSets || [])
      }
    } catch (e) { console.error(e) }
    finally { setSubLoading(false) }
  }

  async function drillIntoAdGroup(adGroup: any) {
    const newDrill: DrillState = { ...drill, level: 'ads', adGroup: { id: adGroup.id, name: adGroup.name } }
    saveDrill(newDrill)
    setSubLoading(true)
    setSubRows([])
    try {
      const base = (customStart ? '&customStart=' + customStart : '') + (customEnd ? '&customEnd=' + customEnd : '')
      const campaignPlatform = drill.campaign?.platform || (platform === 'combined' ? 'google' : platform as 'google' | 'meta')
      if (campaignPlatform === 'google') {
        const res = await fetch('/api/google/ads?accountId=' + googleAccountId + '&adGroupId=' + adGroup.id + '&dateRange=' + dateRange + base)
        const d = await res.json()
        setSubRows(d.ads || [])
      } else if (campaignPlatform === 'meta') {
        const res = await fetch('/api/meta/ads?adSetId=' + adGroup.id + '&dateRange=' + dateRange + base)
        const d = await res.json()
        setSubRows(d.ads || [])
      }
    } catch (e) { console.error(e) }
    finally { setSubLoading(false) }
  }

  function navigateTo(level: DrillLevel) {
    if (level === 'campaigns') {
      saveDrill({ level: 'campaigns', campaign: null, adGroup: null })
      setSubRows([])
    } else if (level === 'adgroups' && drill.campaign) {
      drillIntoCampaign(drill.campaign)
    }
  }

  // On mount, if drill state was persisted at adgroups/ads level, restore the data
  useEffect(() => {
    if (drill.level === 'adgroups' && drill.campaign) {
      drillIntoCampaign(drill.campaign)
    } else if (drill.level === 'ads' && drill.campaign && drill.adGroup) {
      // First restore adgroups level data isn't needed — just re-fetch ads
      drillIntoAdGroup(drill.adGroup)
    }
  }, []) // eslint-disable-line

  const currentRows = drill.level === 'campaigns' ? campaigns : subRows
  const levelLabel = drill.level === 'campaigns' ? campaigns.length + ' campaigns'
    : drill.level === 'adgroups' ? subRows.length + ' ' + (platform === 'meta' ? 'ad sets' : 'ad groups')
    : subRows.length + ' ads'

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Campaigns</h2>
        <p className="text-sm text-muted font-mono">{levelLabel}</p>
      </div>

      <Breadcrumb drill={drill} onNavigate={navigateTo} />

      {drill.level === 'campaigns' && platform === 'google' && googleAccountId && <GoogleChart accountId={googleAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {drill.level === 'campaigns' && platform === 'meta' && metaAccountId && <MetaChart accountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {drill.level === 'campaigns' && platform === 'combined' && googleAccountId && metaAccountId && <CombinedChart googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {drill.level === 'adgroups' && drill.campaign && (
        <AdGroupChart campaignId={drill.campaign.id} accountId={googleAccountId} dateRange={dateRange} platform={platform} metaAccountId={metaAccountId} customStart={customStart} customEnd={customEnd} />
      )}
      {drill.level === 'ads' && subRows.length > 0 && <AdBarChart ads={subRows} />}

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono text-muted">{levelLabel} · {activeCols.length} columns</p>
        <ColumnPicker platform={platform} active={activeCols} onChange={updateCols} />
      </div>

      {subLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="flex items-center gap-2 text-muted font-mono text-sm">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />Loading...
          </div>
        </div>
      ) : (
        <DrillTable rows={currentRows} level={drill.level} platform={platform} activeCols={activeCols}
          onRowClick={drill.level === 'campaigns' ? drillIntoCampaign : drillIntoAdGroup} />
      )}
    </div>
  )
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────
function KeywordsTab({ accountId, dateRange }: { accountId: string; dateRange: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const kwCols = [
    { id: 'spend', label: 'Spend', defaultOn: true },
    { id: 'clicks', label: 'Clicks', defaultOn: true },
    { id: 'ctr', label: 'CTR', defaultOn: true },
    { id: 'qs', label: 'QS', defaultOn: true },
    { id: 'impressions', label: 'Impressions', defaultOn: false },
    { id: 'avgCpc', label: 'Avg CPC', defaultOn: false },
    { id: 'conversions', label: 'Conv.', defaultOn: false },
    { id: 'costPerConv', label: 'Cost/Conv', defaultOn: false },
  ]
  const [activeCols, setActiveCols] = useState<string[]>(() => lsJson('advar-kw-cols', kwCols.filter(c => c.defaultOn).map(c => c.id)))
  const has = (id: string) => activeCols.includes(id)
  const updateCols = (cols: string[]) => { setActiveCols(cols); lsSet('advar-kw-cols', JSON.stringify(cols)) }

  useEffect(() => {
    setLoading(true)
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json()).then(d => { setKeywords(d.keywords || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, dateRange])

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sorted = [...keywords].sort((a, b) => {
    let av = 0, bv = 0
    if (sortCol === 'spend') { av = Number(a.cost); bv = Number(b.cost) }
    else if (sortCol === 'clicks') { av = Number(a.clicks); bv = Number(b.clicks) }
    else if (sortCol === 'ctr') { av = Number(a.ctr); bv = Number(b.ctr) }
    else if (sortCol === 'qs') { av = Number(a.qualityScore || 0); bv = Number(b.qualityScore || 0) }
    else if (sortCol === 'impressions') { av = Number(a.impressions || 0); bv = Number(b.impressions || 0) }
    else if (sortCol === 'avgCpc') { av = Number(a.avgCpc || 0); bv = Number(b.avgCpc || 0) }
    else if (sortCol === 'conversions') { av = Number(a.conversions || 0); bv = Number(b.conversions || 0) }
    else if (sortCol === 'costPerConv') { av = Number(a.conversions) > 0 ? Number(a.cost) / Number(a.conversions) : 0; bv = Number(b.conversions) > 0 ? Number(b.cost) / Number(b.conversions) : 0 }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const SortTh = ({ id, label }: { id: string; label: string }) => (
    <th onClick={() => handleSort(id)} className="text-right px-3 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none whitespace-nowrap">
      {label}{sortCol === id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )

  const matchLabel = (mt: string) => {
    if (mt === '4' || mt === 'BROAD') return 'Broad'
    if (mt === '3' || mt === 'PHRASE') return 'Phrase'
    if (mt === '2' || mt === 'EXACT') return 'Exact'
    return mt
  }

  const qsColor = (qs: any) => {
    const n = Number(qs)
    if (n >= 7) return 'text-green-600'
    if (n >= 4) return 'text-amber-500'
    return 'text-red-600'
  }

  const totalSpend = keywords.reduce((s, k) => s + Number(k.cost), 0)
  const totalClicks = keywords.reduce((s, k) => s + Number(k.clicks), 0)
  const totalImpressions = keywords.reduce((s, k) => s + Number(k.impressions || 0), 0)
  const totalConversions = keywords.reduce((s, k) => s + Number(k.conversions || 0), 0)
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0
  const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Keywords</h2>
          <p className="text-sm text-muted font-mono">Top 200 by spend</p>
        </div>
        <div className="relative">
          <button onClick={() => setColPickerOpen(!colPickerOpen)} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">⊞ Columns</button>
          {colPickerOpen && (
            <div className="absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-48">
              <p className="font-mono text-xs text-muted uppercase tracking-wider mb-3">Show columns</p>
              {kwCols.map(col => (
                <label key={col.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" checked={activeCols.includes(col.id)}
                    onChange={e => { if (e.target.checked) updateCols([...activeCols, col.id]); else updateCols(activeCols.filter(c => c !== col.id)) }}
                    className="accent-accent" />
                  <span className="text-xs text-ink">{col.label}</span>
                </label>
              ))}
              <button onClick={() => setColPickerOpen(false)} className="mt-3 text-xs text-muted hover:text-ink font-mono">Done</button>
            </div>
          )}
        </div>
      </div>
      {loading ? <div className="text-muted text-sm font-mono">Loading keywords...</div> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface">Keyword</th>
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider">Match</th>
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider hidden md:table-cell">Campaign</th>
                {has('impressions') && <SortTh id="impressions" label="Impr." />}
                {has('spend') && <SortTh id="spend" label="Spend" />}
                {has('clicks') && <SortTh id="clicks" label="Clicks" />}
                {has('avgCpc') && <SortTh id="avgCpc" label="Avg CPC" />}
                {has('ctr') && <SortTh id="ctr" label="CTR" />}
                {has('conversions') && <SortTh id="conversions" label="Conv." />}
                {has('costPerConv') && <SortTh id="costPerConv" label="Cost/Conv" />}
                {has('qs') && <SortTh id="qs" label="QS" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map((k: any, i: number) => (
                <tr key={i} className="table-row">
                  <td className="px-3 py-3 font-medium sticky left-0 bg-white max-w-[120px] truncate">{k.text}</td>
                  <td className="px-3 py-3 text-xs font-mono text-muted">{matchLabel(k.matchType)}</td>
                  <td className="px-3 py-3 text-xs text-muted truncate max-w-xs hidden md:table-cell">{k.campaign}</td>
                  {has('impressions') && <td className="px-3 py-3 text-right font-mono text-sm">{Number(k.impressions || 0).toLocaleString()}</td>}
                  {has('spend') && <td className="px-3 py-3 text-right font-mono text-sm">${k.cost}</td>}
                  {has('clicks') && <td className="px-3 py-3 text-right font-mono text-sm">{k.clicks}</td>}
                  {has('avgCpc') && <td className="px-3 py-3 text-right font-mono text-sm">{k.avgCpc ? '$' + k.avgCpc : '—'}</td>}
                  {has('ctr') && <td className="px-3 py-3 text-right font-mono text-sm">{k.ctr}%</td>}
                  {has('conversions') && <td className="px-3 py-3 text-right font-mono text-sm">{k.conversions || '—'}</td>}
                  {has('costPerConv') && <td className="px-3 py-3 text-right font-mono text-sm">{Number(k.conversions) > 0 ? '$' + (Number(k.cost) / Number(k.conversions)).toFixed(2) : '—'}</td>}
                  {has('qs') && <td className="px-3 py-3 text-right font-mono text-sm font-medium">{k.qualityScore ? <span className={'cursor-help ' + qsColor(k.qualityScore)}>{k.qualityScore}</span> : <span className="text-muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
            {keywords.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface font-medium">
                  <td className="px-3 py-3 font-mono text-xs text-muted sticky left-0 bg-surface">Total</td>
                  <td className="px-3 py-3" /><td className="px-3 py-3 hidden md:table-cell" />
                  {has('impressions') && <td className="px-3 py-3 text-right font-mono text-sm">{totalImpressions.toLocaleString()}</td>}
                  {has('spend') && <td className="px-3 py-3 text-right font-mono text-sm">${totalSpend.toFixed(2)}</td>}
                  {has('clicks') && <td className="px-3 py-3 text-right font-mono text-sm">{totalClicks.toLocaleString()}</td>}
                  {has('avgCpc') && <td className="px-3 py-3 text-right font-mono text-sm">{avgCpc > 0 ? '$' + avgCpc.toFixed(2) : '—'}</td>}
                  {has('ctr') && <td className="px-3 py-3 text-right font-mono text-sm">{avgCtr.toFixed(2)}%</td>}
                  {has('conversions') && <td className="px-3 py-3 text-right font-mono text-sm">{totalConversions.toFixed(1)}</td>}
                  {has('costPerConv') && <td className="px-3 py-3 text-right font-mono text-sm">{cpa > 0 ? '$' + cpa.toFixed(2) : '—'}</td>}
                  {has('qs') && <td className="px-3 py-3 text-right font-mono text-sm text-muted">avg</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────
function ChatTab({ messages, input, loading, onInputChange, onSend, accountSelected, onDownload, onUpload, exchangeCount, platform, clientName }: any) {
  const atLimit = exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0
  const warningNext = exchangeCount % 4 === 3 && exchangeCount > 0 && messages.length > 0
  const platformLabel = platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta Ads' : 'all platforms'
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Ask Claude</h2>
          <p className="text-sm text-muted font-mono">{clientName} · {platformLabel}</p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs font-mono text-muted hover:text-ink border border-border px-2 md:px-3 py-1.5 transition-colors cursor-pointer">
            ↑ <span className="hidden md:inline">Resume chat</span>
            <input type="file" accept=".txt" onChange={onUpload} className="hidden" />
          </label>
          {messages.length > 0 && (
            <button onClick={onDownload} className="text-xs font-mono text-muted hover:text-ink border border-border px-2 md:px-3 py-1.5 transition-colors">
              ↓ <span className="hidden md:inline">Save chat</span>
            </button>
          )}
        </div>
      </div>
      {warningNext && (
        <div className="mb-4 bg-red-50 border-2 border-red-400 px-4 py-3">
          <p className="text-sm text-red-700 font-semibold">⚠️ 1 exchange remaining. <button onClick={onDownload} className="underline font-bold">Save transcript</button> now.</p>
        </div>
      )}
      {atLimit && (
        <div className="mb-4 bg-ink px-6 py-5 text-center">
          <p className="text-paper font-semibold mb-1">You have used all 4 exchanges.</p>
          <p className="text-paper text-sm mb-4 opacity-80">Download your transcript, then re-upload to continue.</p>
          <button onClick={onDownload} className="bg-paper text-ink text-sm font-mono px-5 py-2 hover:bg-surface transition-colors">↓ Download transcript</button>
        </div>
      )}
      <div className="bg-white border border-border flex flex-col" style={{ height: 'calc(100vh - 200px)' }}>
        <div id="chat-messages" className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto">
          {messages.length === 0 && (
            <div className="text-muted text-sm font-mono space-y-2">
              <p>Try asking:</p>
              <p className="text-ink">"Which campaigns have the best ROAS?"</p>
              <p className="text-ink">"What's underperforming and why?"</p>
              <p className="text-ink">"Summarize this account's performance"</p>
            </div>
          )}
          {messages.map((m: any, i: number) => (
            <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={'px-4 md:px-6 py-3 md:py-4 text-sm leading-7 ' + (m.role === 'user' ? 'bg-ink text-paper max-w-xs md:max-w-xl' : 'bg-surface text-ink border border-border w-full chat-response')}>
                {m.role === 'user' ? m.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border p-3 md:p-4 flex gap-2 md:gap-3">
          <input type="text" value={input} onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !atLimit && onSend()}
            placeholder={accountSelected ? (atLimit ? 'Download and re-upload to continue...' : 'Ask about ' + clientName + '...') : 'Select a client first'}
            disabled={!accountSelected || atLimit}
            className="flex-1 border border-border px-3 py-2.5 text-sm bg-paper focus:outline-none focus:border-accent font-sans disabled:opacity-50" />
          <button onClick={onSend} disabled={!accountSelected || loading || atLimit} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">Send</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function DashboardContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [activePlatform, setActivePlatform] = useState<Platform>(() => (ls('advar-active-platform') as Platform) || 'google')
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat'>(() => (ls('advar-active-tab') as any) || 'overview')
  const [dateRange, setDateRange] = useState<string>(() => ls('advar-date-range') || 'LAST_30_DAYS')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [platformData, setPlatformData] = useState<PlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)

  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>(() => lsJson('advar-chat-messages', []))
  const [chatLoading, setChatLoading] = useState(false)
  const [sessionStart, setSessionStart] = useState<number>(() => parseInt(ls('advar-session-start') || '0'))

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])
  useEffect(() => { if (session) fetchClients() }, [session])

  // Prevent auto-refresh when switching back to this browser tab
  useEffect(() => {
    const handleVisibility = (e: Event) => { e.stopImmediatePropagation() }
    document.addEventListener('visibilitychange', handleVisibility, true)
    return () => document.removeEventListener('visibilitychange', handleVisibility, true)
  }, [])
  useEffect(() => { if (chatMessages.length > 0) lsSet('advar-chat-messages', JSON.stringify(chatMessages)) }, [chatMessages])
  useEffect(() => { lsSet('advar-session-start', String(sessionStart)) }, [sessionStart])

  async function fetchClients() {
    try {
      const res = await fetch('/api/clients')
      const data = await res.json()
      const list: Client[] = data.clients || []
      setClients(list)
      const savedId = ls('advar-active-client')
      const saved = list.find(c => c.id === savedId)
      const toSelect = saved || list[0] || null
      if (toSelect) selectClient(toSelect)
    } catch (e) { console.error(e) }
  }

  function selectClient(client: Client, overridePlatform?: Platform) {
    setSelectedClient(client)
    lsSet('advar-active-client', client.id)
    const hasGoogle = client.platform_connections.some(p => p.platform === 'google')
    const hasMeta = client.platform_connections.some(p => p.platform === 'meta')
    const savedPlatform = overridePlatform || (ls('advar-active-platform') as Platform) || 'google'
    const resolved: Platform = (savedPlatform === 'google' && hasGoogle) ? 'google'
      : (savedPlatform === 'meta' && hasMeta) ? 'meta'
      : (savedPlatform === 'combined' && hasGoogle && hasMeta) ? 'combined'
      : hasGoogle ? 'google' : hasMeta ? 'meta' : 'google'
    setActivePlatform(resolved)
    // Restore saved tab
    const savedTab = ls('advar-active-tab') as any
    if (savedTab) setActiveTab(savedTab)
    // Only reset drill state when switching to a different client
    const previousClientId = ls('advar-active-client-prev')
    if (previousClientId && previousClientId !== client.id) {
      lsSet('advar-drill-state', JSON.stringify({ level: 'campaigns', campaign: null, adGroup: null }))
    }
    lsSet('advar-active-client-prev', client.id)
    loadData(client, resolved, dateRange, customStart, customEnd)
  }

  function changePlatform(platform: Platform) {
    setActivePlatform(platform)
    lsSet('advar-active-platform', platform)
    // Reset drill when switching platforms
    lsSet('advar-drill-state', JSON.stringify({ level: 'campaigns', campaign: null, adGroup: null }))
    if (selectedClient) loadData(selectedClient, platform, dateRange, customStart, customEnd)
  }

  function changeTab(tab: 'overview' | 'campaigns' | 'keywords' | 'chat') {
    setActiveTab(tab)
    lsSet('advar-active-tab', tab)
  }

  function changeDateRange(val: string) {
    setDateRange(val)
    lsSet('advar-date-range', val)
    if (val === 'CUSTOM') { setShowCustomPicker(true); return }
    setShowCustomPicker(false); setCustomStart(''); setCustomEnd('')
    if (selectedClient) loadData(selectedClient, activePlatform, val, '', '')
  }

  function applyCustomRange() {
    if (customStart && customEnd && selectedClient) loadData(selectedClient, activePlatform, 'CUSTOM', customStart, customEnd)
  }

  async function loadData(client: Client, platform: Platform, dr: string, cs: string, ce: string) {
    const googleConn = client.platform_connections.find(p => p.platform === 'google')
    const metaConn = client.platform_connections.find(p => p.platform === 'meta')
    const params = new URLSearchParams()
    params.set('platform', platform)
    if (googleConn) params.set('googleAccountId', googleConn.account_id)
    if (metaConn) params.set('metaAccountId', metaConn.account_id)
    params.set('dateRange', dr)
    if (cs) params.set('customStart', cs)
    if (ce) params.set('customEnd', ce)
    setLoading(true); setPlatformData(null)
    try {
      const res = await fetch('/api/platform?' + params.toString())
      setPlatformData(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function sendChat() {
    if (!chatInput.trim() || !selectedClient) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }]
    setChatMessages(newMessages)
    setChatLoading(true)
    const history = newMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
    const googleConn = selectedClient.platform_connections.find(p => p.platform === 'google')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, accountId: googleConn?.account_id, summary: platformData, dateRange, history: history.slice(0, -1), accountName: selectedClient.name, platform: activePlatform }),
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
    } catch { setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]) }
    finally { setChatLoading(false) }
  }

  function downloadChat() {
    const text = chatMessages.map(m => (m.role === 'user' ? 'You' : 'Claude') + ': ' + m.content).join('\n\n---\n\n')
    const header = 'Advar Chat Export\nClient: ' + (selectedClient?.name || '') + '\nDate: ' + new Date().toLocaleDateString() + '\n\n'
    const blob = new Blob([header + text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = 'advar-' + (selectedClient?.name || 'chat').replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + new Date().toISOString().split('T')[0] + '.txt'
    a.click(); URL.revokeObjectURL(url)
  }

  function uploadChat(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const lines = text.split('\n\n---\n\n')
      const messages: { role: string; content: string }[] = []
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('You: ')) messages.push({ role: 'user', content: t.slice(5) })
        else if (t.startsWith('Claude: ')) messages.push({ role: 'assistant', content: t.slice(8) })
      }
      if (messages.length > 0) {
        const restored = [...messages, { role: 'assistant', content: "I've read through our previous conversation and have full context. What would you like to tackle next?" }]
        setChatMessages(restored); setSessionStart(restored.length)
        setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
      }
    }
    reader.readAsText(file); e.target.value = ''
  }

  if (status === 'loading') return <LoadingScreen />

  const exchangeCount = Math.floor((chatMessages.length - sessionStart) / 2)
  const googleConn = selectedClient?.platform_connections.find(p => p.platform === 'google')
  const metaConn = selectedClient?.platform_connections.find(p => p.platform === 'meta')
  const hasGoogle = !!googleConn
  const hasMeta = !!metaConn
  const hasBoth = hasGoogle && hasMeta
  const googleAccountId = googleConn?.account_id || ''
  const metaAccountId = metaConn?.account_id || ''
  const visibleNavItems = NAV_ITEMS.filter(item => !(item.googleOnly && activePlatform !== 'google'))
  const dateLabel = dateRange === 'CUSTOM' && customStart && customEnd ? customStart + ' – ' + customEnd : DATE_RANGES.find(d => d.value === dateRange)?.label || ''

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Desktop Sidebar */}
      <div className={`hidden md:flex flex-col border-r border-border bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`} style={{ minHeight: '100vh', position: 'sticky', top: 0, maxHeight: '100vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          {!sidebarCollapsed && <span className="font-display text-lg text-ink">Advar</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-muted hover:text-ink transition-colors ml-auto">
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>
        {!sidebarCollapsed && (
          <div className="px-3 py-2 border-b border-border flex-shrink-0">
            <select value={dateRange} onChange={e => changeDateRange(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent">
              {DATE_RANGES.map(dr => <option key={dr.value} value={dr.value}>{dr.label}</option>)}
            </select>
            {showCustomPicker && (
              <div className="mt-2 space-y-1">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent" />
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent" />
                <button onClick={applyCustomRange} disabled={!customStart || !customEnd} className="w-full btn-primary text-xs py-1.5 disabled:opacity-50">Apply</button>
              </div>
            )}
          </div>
        )}
        {selectedClient && (hasGoogle || hasMeta) && (
          <div className="border-b border-border flex-shrink-0">
            {!sidebarCollapsed && <p className="px-4 pt-2 pb-1 font-mono text-xs text-muted uppercase tracking-wider">Platform</p>}
            {hasGoogle && (
              <button onClick={() => changePlatform('google')} title={sidebarCollapsed ? 'Google Ads' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'google' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <span className="text-sm flex-shrink-0">🔵</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Google Ads</span>}
              </button>
            )}
            {hasMeta && (
              <button onClick={() => changePlatform('meta')} title={sidebarCollapsed ? 'Meta Ads' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'meta' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <span className="text-sm flex-shrink-0">🔷</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Meta Ads</span>}
              </button>
            )}
            {hasBoth && (
              <button onClick={() => changePlatform('combined')} title={sidebarCollapsed ? 'Combined' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 pb-2 transition-colors ' + (activePlatform === 'combined' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <span className="text-sm flex-shrink-0">⊕</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Combined</span>}
              </button>
            )}
          </div>
        )}
        <nav className="py-2 flex-shrink-0">
          {visibleNavItems.map(item => (
            <button key={item.id} onClick={() => changeTab(item.id as any)} title={sidebarCollapsed ? item.label : undefined}
              className={'w-full flex items-center gap-3 px-4 py-2.5 transition-colors ' + (activeTab === item.id ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-surface')}>
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-border flex-shrink-0">
          {!sidebarCollapsed && (
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="font-mono text-xs text-muted uppercase tracking-wider">Clients</span>
              <a href="/clients" className="text-xs text-accent hover:underline font-mono">+ Edit</a>
            </div>
          )}
          <div className="pb-2 overflow-y-auto" style={{ maxHeight: '160px' }}>
            {clients.map(client => (
              <button key={client.id} onClick={() => selectClient(client)} title={sidebarCollapsed ? client.name : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (selectedClient?.id === client.id ? 'bg-surface text-ink font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <span className="w-4 h-4 rounded-full bg-accent flex-shrink-0 flex items-center justify-center text-white text-xs">{client.name.charAt(0).toUpperCase()}</span>
                {!sidebarCollapsed && <span className="text-xs truncate">{client.name}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-border py-2 mt-auto flex-shrink-0">
          <button onClick={() => selectedClient && loadData(selectedClient, activePlatform, dateRange, customStart, customEnd)} title="Refresh"
            className="w-full flex items-center gap-3 px-4 py-2.5 text-muted hover:text-ink hover:bg-surface transition-colors">
            <span className="text-base w-4 text-center">↻</span>
            {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">Refresh</span>}
          </button>
          <button onClick={() => signOut({ callbackUrl: '/' })} title="Sign out"
            className="w-full flex items-center gap-3 px-4 py-2.5 text-muted hover:text-ink hover:bg-surface transition-colors">
            <span className="text-base w-4 text-center">⇥</span>
            {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">Sign out</span>}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="hidden md:flex border-b border-border px-8 py-3 items-center justify-between bg-white sticky top-0 z-10">
          <p className="text-xs text-muted font-mono">
            {loading
              ? <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse inline-block" />Loading...</span>
              : selectedClient ? selectedClient.name + ' · ' + dateLabel : ''}
          </p>
        </div>
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-border sticky top-0 z-10">
          <span className="font-display text-base text-ink">Advar</span>
          <select value={selectedClient?.id || ''} onChange={e => { const c = clients.find(cl => cl.id === e.target.value); if (c) selectClient(c) }}
            className="flex-1 mx-3 text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none">
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-muted hover:text-ink p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-border px-4 py-3 space-y-2 sticky top-14 z-10">
            <select value={dateRange} onChange={e => changeDateRange(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono text-ink">
              {DATE_RANGES.map(dr => <option key={dr.value} value={dr.value}>{dr.label}</option>)}
            </select>
            {showCustomPicker && (
              <div className="space-y-1">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono" />
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono" />
                <button onClick={() => { applyCustomRange(); setMobileMenuOpen(false) }} className="w-full btn-primary text-xs py-2">Apply</button>
              </div>
            )}
            {selectedClient && (hasGoogle || hasMeta) && (
              <div className="flex gap-2">
                {hasGoogle && <button onClick={() => { changePlatform('google'); setMobileMenuOpen(false) }} className={'flex-1 text-xs font-mono border py-1.5 ' + (activePlatform === 'google' ? 'bg-ink text-white border-ink' : 'border-border text-muted')}>🔵 Google</button>}
                {hasMeta && <button onClick={() => { changePlatform('meta'); setMobileMenuOpen(false) }} className={'flex-1 text-xs font-mono border py-1.5 ' + (activePlatform === 'meta' ? 'bg-ink text-white border-ink' : 'border-border text-muted')}>🔷 Meta</button>}
                {hasBoth && <button onClick={() => { changePlatform('combined'); setMobileMenuOpen(false) }} className={'flex-1 text-xs font-mono border py-1.5 ' + (activePlatform === 'combined' ? 'bg-ink text-white border-ink' : 'border-border text-muted')}>⊕ Both</button>}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { selectedClient && loadData(selectedClient, activePlatform, dateRange, customStart, customEnd); setMobileMenuOpen(false) }}
                className="flex-1 text-xs font-mono text-muted border border-border py-2 hover:text-ink">↻ Refresh</button>
              <button onClick={() => signOut({ callbackUrl: '/' })} className="flex-1 text-xs font-mono text-muted border border-border py-2 hover:text-ink">Sign out</button>
            </div>
          </div>
        )}
        <main className="flex-1 px-4 md:px-8 py-4 md:py-8 pb-20 md:pb-8">
          {selectedClient && <h1 className="font-display text-2xl md:text-3xl text-ink mb-6">{selectedClient.name}</h1>}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="flex items-center gap-2 text-muted font-mono text-sm">
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />Loading...
              </div>
            </div>
          )}
          {!loading && platformData && activeTab === 'overview' && (
            <OverviewTab data={platformData} googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} clientName={selectedClient?.name || ''} customStart={customStart} customEnd={customEnd} />
          )}
          {!loading && platformData && activeTab === 'campaigns' && (
            <CampaignsTab data={platformData} googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
          )}
          {!loading && activeTab === 'keywords' && activePlatform === 'google' && googleAccountId && (
            <KeywordsTab accountId={googleAccountId} dateRange={dateRange} />
          )}
          {activeTab === 'chat' && (
            <ChatTab messages={chatMessages} input={chatInput} loading={chatLoading} onInputChange={setChatInput}
              onSend={sendChat} accountSelected={!!selectedClient} onDownload={downloadChat} onUpload={uploadChat}
              exchangeCount={exchangeCount} platform={activePlatform} clientName={selectedClient?.name || ''} />
          )}
          {!selectedClient && clients.length === 0 && !loading && (
            <div className="flex items-center justify-center h-64 flex-col gap-4">
              <p className="text-muted font-mono text-sm">No clients set up yet.</p>
              <a href="/clients" className="btn-primary text-sm">Set up clients →</a>
            </div>
          )}
        </main>
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border z-20">
          <div className="flex">
            {visibleNavItems.map(item => (
              <button key={item.id} onClick={() => { changeTab(item.id as any); setMobileMenuOpen(false) }}
                className={'flex-1 flex flex-col items-center py-2 px-1 transition-colors ' + (activeTab === item.id ? 'text-accent' : 'text-muted hover:text-ink')}>
                <span className="text-lg leading-none mb-0.5">{item.icon}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide">{item.label === 'Ask Claude' ? 'Claude' : item.label}</span>
              </button>
            ))}
            <button onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={'flex-1 flex flex-col items-center py-2 px-1 transition-colors ' + (mobileMoreOpen ? 'text-accent' : 'text-muted hover:text-ink')}>
              <span className="text-lg leading-none mb-0.5">•••</span>
              <span className="font-mono text-[10px] uppercase tracking-wide">More</span>
            </button>
          </div>
          {mobileMoreOpen && (
            <div className="border-t border-border bg-white px-4 py-3">
              <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">Coming soon</p>
              <p className="text-xs text-muted">Settings · Billing · Support</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardContent />
    </Suspense>
  )
}
