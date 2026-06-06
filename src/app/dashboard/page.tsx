'use client'
import { filterAnomalies } from '@/lib/anomaly-filter'
import { DiamondCoachmark } from '@/components/DiamondCoachmark'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useEffect, useLayoutEffect, useState, useRef, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { Campaign, PlatformData, Platform, CampaignStatus } from '@/lib/platforms/types'
import type { IntelligenceGa } from '@/lib/intelligence/intelligence-types'
import { COLUMN_DEFS, statusLabel, statusBadgeClass } from '@/lib/platforms/types'
import { IconLayoutDashboard, IconTarget, IconSearch, IconSparkles, IconChartBar, IconShoppingBag, IconShoppingCart, IconBrandGoogle, IconBrandMeta, IconLayersIntersect, IconRefresh, IconLogout, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'

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
  { id: 'campaigns', label: 'Campaigns', icon: '◈', hideForShopifyOnly: true },
  { id: 'shopify', label: 'Shopify', icon: '🛍', shopifyOnly: true },
  { id: 'woocommerce', label: 'WooCommerce', icon: '🛒', wooOnly: true },  // LORAMER_WOO_TAB_V1
  { id: 'ga', label: 'Analytics', icon: '📊', gaOnly: true },  // LORAMER_GA_DASHBOARD_TAB_V1
  { id: 'keywords', label: 'Keywords', icon: '⌖', googleOnly: true },
  { id: 'chat', label: 'Lora', icon: '✦' },
]

// LORAMER_NAV_ICONS_TYPE_V1
const NAV_ICONS: Record<string, any> = { overview: IconLayoutDashboard, campaigns: IconTarget, keywords: IconSearch, chat: IconSparkles, shopify: IconShoppingBag, woocommerce: IconShoppingCart, ga: IconChartBar }
function NavIcon({ id, size = 18 }: { id: string; size?: number }) { const Ico = NAV_ICONS[id]; return Ico ? <Ico size={size} stroke={1.75} className="flex-shrink-0" /> : null }

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea',
  '#0891b2', '#dc2626', '#ca8a04', '#db2777',
  '#65a30d', '#7c3aed',
]

// --- Warm chart theme (shared by all charts) ---
const AXIS_TICK = { fontSize: 12, fontFamily: 'var(--font-body, system-ui, -apple-system, sans-serif)', fill: '#64748b' }

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{
      background: 'rgba(255,255,255,0.98)',
      border: '1px solid #e7e2d8',
      borderRadius: 12,
      boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
      padding: '12px 14px',
      fontFamily: 'var(--font-body, system-ui, -apple-system, sans-serif)',
      fontSize: 13,
      lineHeight: 1.5,
    }}>
      {label != null && (
        <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 8, fontSize: 13 }}>{label}</div>
      )}
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: i === 0 ? 0 : 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
          <span style={{ color: '#64748b' }}>{entry.name}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#1e293b' }}>
            {typeof entry.value === 'number'
              ? (CURRENCY_KEYS.has(entry.dataKey)
                  ? '$' + entry.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 }))
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

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

// Invalidate all insight caches for a client so every InsightChat re-fetches
// with the latest conversations after any box saves a new message
function invalidateInsightCaches(clientId: string) {
  if (typeof window === 'undefined') return
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('advar-insight-' + clientId + '-'))
    keys.forEach(k => localStorage.removeItem(k))
  } catch {}
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
  { id: 'cost', label: 'Spend', currency: true, color: '#2563eb' },
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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
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
  { id: 'cost', label: 'Spend', currency: true, color: '#0ea5e9' },
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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {META_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Combined Chart ───────────────────────────────────────────────────────────
// Hoisted to module scope (LORAMER_CHART_CURRENCY_V1) so CURRENCY_KEYS can read it;
// pure constant, no component dependencies.
const COMBINED_METRICS = [
  { id: 'cost', label: 'Spend', currency: true, googleKey: 'google_cost', metaKey: 'meta_cost', googleColor: '#2563eb', metaColor: '#0ea5e9' },
  { id: 'clicks', label: 'Clicks', googleKey: 'google_clicks', metaKey: 'meta_clicks', googleColor: '#16a34a', metaColor: '#10b981' },
  { id: 'conversions', label: 'Conversions', googleKey: 'google_conversions', metaKey: 'meta_conversions', googleColor: '#ea580c', metaColor: '#f97316' },
]

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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
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

  const metricLabels: Record<string, string> = { cost: 'Spend', clicks: 'Clicks', impressions: 'Impressions', conversions: 'Conversions' }
  const metricColors: Record<string, string> = { cost: '#2563eb', clicks: '#16a34a', impressions: '#9333ea', conversions: '#ea580c' }

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
            {(Object.keys(metricLabels)).map(m => (
              <button key={m} onClick={() => setActiveMetric(m as any)}
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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {series.filter(s => visibleIds.has(s.id)).map(s => (
            <Line key={s.id} type="monotone" dataKey={s.id} stroke={colorMap[s.id]} strokeWidth={2} dot={false} name={s.name} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Ad Chart (bar for multiple ads, line for single ad, toggleable) ──────────
function AdChart({ ads, adGroupId, platform, accountId, metaAccountId, dateRange, customStart, customEnd }: {
  ads: any[]
  adGroupId: string
  platform: 'google' | 'meta'
  accountId: string
  metaAccountId?: string
  dateRange: string
  customStart?: string
  customEnd?: string
}) {
  const [viewMode, setViewMode] = useState<'bar' | 'line'>(ads.length === 1 ? 'line' : 'bar')
  const [activeMetric, setActiveMetric] = useState<'spend' | 'clicks' | 'conversions' | 'ctr'>('spend')
  const [lineData, setLineData] = useState<{ id: string; name: string; daily: any[] }[]>([])
  const [lineLoading, setLineLoading] = useState(false)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set(ads.map(a => a.id)))

  const metricColors: Record<string, string> = { spend: '#2563eb', clicks: '#16a34a', conversions: '#ea580c', ctr: '#9333ea' }
  const metricLabels: Record<string, string> = { spend: 'Spend', clicks: 'Clicks', conversions: 'Conversions', ctr: 'CTR' }

  useEffect(() => {
    if (viewMode !== 'line') return
    setLineLoading(true)
    const base = (customStart ? '&customStart=' + customStart : '') + (customEnd ? '&customEnd=' + customEnd : '')

    const fetchParentTrend = async () => {
      // Fetch the parent ad group/ad set daily trend
      // This gives context for the time period while viewing ads
      let url: string
      if (platform === 'google') {
        url = '/api/google/adgroups/daily?accountId=' + accountId + '&campaignId=' + adGroupId + '&dateRange=' + dateRange + base
        const res = await fetch(url)
        const d = await res.json()
        // Use the ad group that matches adGroupId, or aggregate all
        const groups = d.adGroups || []
        const matchingGroup = groups.find((g: any) => g.id === adGroupId) || groups[0]
        if (matchingGroup) {
          setLineData([{ id: matchingGroup.id, name: matchingGroup.name, daily: matchingGroup.daily.map((r: any) => ({ ...r, date: String(r.date).slice(5) })) }])
        }
      } else {
        // For Meta, fetch ad set daily data
        url = '/api/meta/daily?accountId=' + (metaAccountId || accountId) + '&campaignId=' + adGroupId + '&dateRange=' + dateRange + base
        const res = await fetch(url)
        const d = await res.json()
        setLineData([{ id: adGroupId, name: 'Ad Set Trend', daily: (d.daily || []).map((r: any) => ({ ...r, date: String(r.date).slice(5) })) }])
      }
      setLineLoading(false)
    }
    fetchParentTrend().catch(() => setLineLoading(false))
  }, [viewMode, adGroupId, platform, accountId, metaAccountId, dateRange, customStart, customEnd])

  const colorMap: Record<string, string> = {}
  ads.forEach((ad, i) => { colorMap[ad.id] = CHART_COLORS[i % CHART_COLORS.length] })

  const merged = (() => {
    const map: Record<string, any> = {}
    lineData.forEach(s => {
      s.daily.forEach((row: any) => {
        if (!map[row.date]) map[row.date] = { date: row.date }
        map[row.date]['value'] = row[activeMetric] ?? 0
      })
    })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  })()

  const toggleVisible = (id: string) => setVisibleIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) { if (next.size > 1) next.delete(id) } else next.add(id)
    return next
  })

  // Bar chart data
  const barData = [...ads].sort((a, b) => (b[activeMetric] || 0) - (a[activeMetric] || 0)).slice(0, 10)
  const max = barData[0]?.[activeMetric] || 1

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Ad Performance</h3>
          <div className="flex items-center gap-2">
            {/* Metric selector */}
            <div className="flex gap-1">
              {(Object.keys(metricLabels)).map(m => (
                <button key={m} onClick={() => setActiveMetric(m as any)}
                  className={'text-xs font-mono px-2 py-1 border transition-colors ' + (activeMetric === m ? 'text-white border-transparent' : 'text-muted border-border hover:text-ink')}
                  style={activeMetric === m ? { backgroundColor: metricColors[m], borderColor: metricColors[m] } : {}}>
                  {metricLabels[m]}
                </button>
              ))}
            </div>
            {/* View toggle — only show if multiple ads */}
            {ads.length > 1 && (
              <div className="flex border border-border">
                <button onClick={() => setViewMode('bar')}
                  className={'text-xs font-mono px-2 py-1 transition-colors ' + (viewMode === 'bar' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  ▦ Bar
                </button>
                <button onClick={() => setViewMode('line')}
                  className={'text-xs font-mono px-2 py-1 transition-colors ' + (viewMode === 'line' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                  ∿ Line
                </button>
              </div>
            )}
          </div>
        </div>

      {viewMode === 'line' && lineData.length > 0 && (
        <p className="text-xs text-muted font-mono mb-3">Showing {lineData[0]?.name} daily trend for context</p>
      )}
      </div>

      {/* Bar view */}
      {viewMode === 'bar' && (
        <div className="space-y-2">
          {barData.map((ad: any, i: number) => {
            const val = ad[activeMetric] || 0
            const pct = (val / max) * 100
            const fv = activeMetric === 'spend' ? fmt(val, 'currency') : activeMetric === 'ctr' ? fmt(val, 'percent') : val.toLocaleString(undefined, { maximumFractionDigits: 1 })
            return (
              <div key={ad.id}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-ink truncate max-w-[70%]">{ad.name}</span>
                  <span className="text-xs font-mono text-muted">{fv}</span>
                </div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: metricColors[activeMetric] }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Line view */}
      {viewMode === 'line' && (
        lineLoading ? (
          <div className="flex items-center justify-center h-32 text-muted font-mono text-sm">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse mr-2" />Loading...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={merged} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              {lineData.length > 0 && (
                <Line type="monotone" dataKey="value" stroke={metricColors[activeMetric]} strokeWidth={2} dot={false} name={metricLabels[activeMetric]} connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>
        )
      )}
    </div>
  )
}

// ─── Drill Table ──────────────────────────────────────────────────────────────
// ─── Right Panel ─────────────────────────────────────────────────────────────
function RightPanel({ open, onClose, onMinimize, title, context, messages, setMessages, input, setInput, loading, setLoading, clientId, clientName, platform, dateRange, customStart, customEnd, quickPrompts }: {
  open: boolean; onClose: () => void; onMinimize: () => void
  title: string; context: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  setMessages: (msgs: { role: 'user' | 'assistant'; content: string }[]) => void
  input: string; setInput: (v: string) => void
  loading: boolean; setLoading: (v: boolean) => void
  clientId: string; clientName: string; platform: Platform; dateRange: string
  customStart?: string; customEnd?: string  // LORAMER_CUSTOM_DATE_RANGE_FIX_V2
  quickPrompts?: string[]  // LORAMER_PANEL_ONLY_V1
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)
  const panelScrollRefMobile = useRef<HTMLDivElement>(null)
  const panelMountedRef = useRef(false)

  useLayoutEffect(() => {
    const els = [panelScrollRef.current, panelScrollRefMobile.current]
    if (!panelMountedRef.current) {
      els.forEach(el => { if (el) el.scrollTop = el.scrollHeight })
      panelMountedRef.current = true
    } else {
      els.forEach(el => { if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) })
    }
  }, [messages.length])

  // LORAMER_CONV_API_V1_RIGHTPANEL + LORAMER_MEMORY_AUTODETECT_V1
  async function saveToClient(msgs: { role: 'user' | 'assistant'; content: string }[]) {
    if (!clientId || msgs.length < 2) return
    const newPair = msgs.slice(-2)
    const scope = title.toLowerCase().replace(/\s+/g, '-') + ':' + platform
    try {
      for (const m of newPair) {
        const r = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            surface: 'right-panel',
            scope,
            role: m.role,
            content: m.content,
          }),
        })
        if (m.role === 'user') {
          const d = await r.json().catch(() => ({}))
          if (d?.proposeMemory && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('loramer-memory-proposal', {
              detail: { clientId, proposal: d.proposeMemory, originalMessage: m.content },
            }))
          }
        }
      }
      invalidateInsightCaches(clientId)
    } catch {}
  }

  async function send(forcedMessage?: string) {
    const userMsg = (forcedMessage || input).trim()
    if (!userMsg || loading) return
    if (!forcedMessage) setInput('')
    setLoading(true)
    const newMessages = [...messages, { role: 'user' as const, content: userMsg }]
    setMessages(newMessages)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: newMessages.slice(0, -1),
          platform, dateRange, customStart, customEnd, clientId, clientName,
          rowContext: context,
          location,  // LORAMER_FOCUS_LOCATION_V1 + LORAMER_CUSTOM_DATE_RANGE_FIX_V2
        }),
      })
      const d = await res.json()
      const final = [...newMessages, { role: 'assistant' as const, content: d.response || 'Something went wrong.' }]
      setMessages(final)
      saveToClient(final)
    } catch {
      setMessages([...newMessages, { role: 'assistant' as const, content: 'Something went wrong.' }])
    } finally { setLoading(false) }
  }

  if (!open) return null

  return (
    <>
      {/* LORAMER_MOBILE_BOTTOM_SHEET_V1 */}
      <div className="fixed inset-0 z-40 pointer-events-none" />
      {/* Desktop: right-side panel (unchanged behavior) */}
      <div className="hidden md:flex fixed right-0 top-0 bottom-0 w-96 bg-white border-l border-border shadow-2xl z-50 flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-white flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono text-accent">✦ Ask Lora</p>
            <p className="text-sm font-medium text-ink truncate">{title}</p>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <button onClick={onMinimize} title="Minimize"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              −
            </button>
            <button onClick={onClose} title="Close"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              ×
            </button>
          </div>
        </div>

        {context && (
          <div className="px-4 py-2 bg-surface border-b border-border flex-shrink-0">
            <p className="text-xs text-muted font-mono truncate">{context}</p>
          </div>
        )}

        <div ref={panelScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (!quickPrompts || quickPrompts.length === 0) && (
            <div className="text-center py-8">
              <p className="text-sm text-muted font-mono">Ask anything about {title}</p>
            </div>
          )}
          {messages.length === 0 && quickPrompts && quickPrompts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted uppercase tracking-wider mb-3">Try asking</p>
              {quickPrompts.map(q => (
                <button key={q} onClick={() => send(q)} disabled={loading}
                  className="w-full text-left text-sm text-ink bg-surface hover:bg-blue-50 hover:text-accent border border-border rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={'text-sm px-3 py-2.5 rounded-xl max-w-[90%] leading-relaxed ' + (m.role === 'user' ? 'bg-accent text-white' : 'bg-surface text-ink border border-border')}>
                {m.role === 'user'
                  ? m.content
                  : <div className="chat-response prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-3 py-2.5 rounded-xl flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-3 border-t border-border bg-white flex-shrink-0">
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask anything..." disabled={loading}
              className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-paper focus:outline-none focus:border-accent disabled:opacity-50" />
            <button onClick={() => send()} disabled={loading || !input.trim()}
              className="bg-accent text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">↑</button>
          </div>
          {messages.length > 0 && (
            <p className="text-xs text-muted font-mono mt-2 text-center">
              {messages.length} messages · saved to client profile
            </p>
          )}
        </div>
      </div>
      {/* Mobile: bottom sheet — covers bottom 75%, top 25% shows page underneath */}
      <div className="flex md:hidden fixed left-0 right-0 bottom-0 top-[25%] bg-white border-t border-border shadow-2xl z-50 flex-col rounded-t-2xl">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-white flex-shrink-0 rounded-t-2xl">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-mono text-accent">✦ Ask Lora</p>
            <p className="text-sm font-medium text-ink truncate">{title}</p>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <button onClick={onMinimize} title="Minimize"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              −
            </button>
            <button onClick={onClose} title="Close"
              className="text-muted hover:text-ink transition-colors text-base leading-none px-1.5 py-0.5 hover:bg-surface rounded">
              ×
            </button>
          </div>
        </div>
        {context && (
          <div className="px-4 py-2 bg-surface border-b border-border flex-shrink-0">
            <p className="text-xs text-muted font-mono truncate">{context}</p>
          </div>
        )}
        <div ref={panelScrollRefMobile} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (!quickPrompts || quickPrompts.length === 0) && (
            <div className="text-center py-8">
              <p className="text-sm text-muted font-mono">Ask anything about {title}</p>
            </div>
          )}
          {messages.length === 0 && quickPrompts && quickPrompts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-muted uppercase tracking-wider mb-3">Try asking</p>
              {quickPrompts.map(q => (
                <button key={q} onClick={() => send(q)} disabled={loading}
                  className="w-full text-left text-sm text-ink bg-surface hover:bg-blue-50 hover:text-accent border border-border rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={'text-sm px-3 py-2.5 rounded-xl max-w-[90%] leading-relaxed ' + (m.role === 'user' ? 'bg-accent text-white' : 'bg-surface text-ink border border-border')}>
                {m.role === 'user'
                  ? m.content
                  : <div className="chat-response prose prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-3 py-2.5 rounded-xl flex gap-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border bg-white flex-shrink-0">
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask anything..." disabled={loading}
              className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-paper focus:outline-none focus:border-accent disabled:opacity-50" />
            <button onClick={() => send()} disabled={loading || !input.trim()}
              className="bg-accent text-white text-sm px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">↑</button>
          </div>
          {messages.length > 0 && (
            <p className="text-xs text-muted font-mono mt-2 text-center">
              {messages.length} messages · saved to client profile
            </p>
          )}
        </div>
      </div>
    </>
  )
}
// ─── Ask Claude Button (row diamond) ───────────────────────────
// LORAMER_PANEL_ONLY_V1 - thin wrapper, opens RightPanel with row context and quick prompts
function AskClaudeButton({ row, level, platform, clientId, clientName, dateRange, openPanel }: {
  row: any; level: DrillLevel; platform: Platform
  clientId: string; clientName: string; dateRange: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[], quickPrompts?: string[]) => void
}) {
  const levelLabel = level === 'campaigns' ? 'Campaign' : level === 'adgroups' ? (platform === 'meta' ? 'Ad Set' : 'Ad Group') : 'Ad'
  const rowContext = [
    levelLabel + ': ' + row.name,
    row.platform ? 'Platform: ' + row.platform : null,
    row.status ? 'Status: ' + row.status : null,
    row.objective ? 'Objective: ' + row.objective : null,
    row.spend != null ? 'Spend: $' + Number(row.spend).toFixed(2) : null,
    row.budget != null ? 'Daily budget: $' + Number(row.budget).toFixed(2) : null,
    row.clicks != null ? 'Clicks: ' + Number(row.clicks).toLocaleString() : null,
    row.impressions != null ? 'Impressions: ' + Number(row.impressions).toLocaleString() : null,
    row.ctr != null ? 'CTR: ' + Number(row.ctr).toFixed(2) + '%' : null,
    row.avgCpc != null ? 'Avg CPC: $' + Number(row.avgCpc).toFixed(2) : null,
    row.cpm != null ? 'CPM: $' + Number(row.cpm).toFixed(2) : null,
    row.reach != null ? 'Reach: ' + Number(row.reach).toLocaleString() : null,
    row.frequency != null ? 'Frequency: ' + Number(row.frequency).toFixed(2) : null,
    row.conversions != null ? 'Conversions: ' + Number(row.conversions).toFixed(1) : null,
    row.conversionValue != null && row.conversionValue > 0 ? 'Conv value: $' + Number(row.conversionValue).toFixed(2) : null,
    row.roas != null ? 'ROAS: ' + Number(row.roas).toFixed(2) + 'x' : null,
    row.costPerConv != null ? 'Cost per conv: $' + Number(row.costPerConv).toFixed(2) : null,
    row.convRate != null ? 'Conv rate: ' + Number(row.convRate).toFixed(2) + '%' : null,
    row.purchases != null ? 'Purchases: ' + row.purchases : null,
    row.addToCart != null ? 'Add to cart: ' + row.addToCart : null,
    row.initiateCheckout != null ? 'Initiate checkout: ' + row.initiateCheckout : null,
    row.costPerPurchase != null ? 'Cost per purchase: $' + Number(row.costPerPurchase).toFixed(2) : null,
    row.description ? 'Ad copy: ' + row.description : null,
    row.body ? 'Ad body: ' + row.body : null,
  ].filter(Boolean).join(' · ')

  const quickPrompts = [
    'Why is this underperforming?',
    'What should I do with this?',
    'How does this compare to account average?',
  ]

  return (
    <button
      onClick={e => { e.stopPropagation(); openPanel(row.name, rowContext, [], quickPrompts) }}
      title={'Ask Lora about this ' + levelLabel.toLowerCase()}
      className="text-xs text-accent hover:bg-blue-100 transition-colors rounded px-1 py-0.5"
    >
      ✦
    </button>
  )
}
function DrillTable({ rows, level, platform, activeCols, onRowClick, onRowSelect, selectedId, clientId, clientName, dateRange, openPanel }: {
  rows: any[]; level: DrillLevel; platform: Platform; activeCols: string[]
  onRowClick: (row: any) => void
  onRowSelect?: (row: any) => void
  selectedId?: string
  clientId?: string; clientName?: string; dateRange?: string
  openPanel?: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
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

  const nameLabel = level === 'campaigns' ? 'Campaign' : level === 'adgroups' ? (platform === 'meta' ? 'Ad Set' : 'Ad Group') : 'Ad'

  function normalizeStatus(s: string): CampaignStatus {
    const u = String(s || '').toUpperCase()
    if (u === 'ACTIVE' || u === 'ENABLED' || u === '2') return 'active'
    if (u === 'PAUSED' || u === '3' || u === 'CAMPAIGN_PAUSED' || u === 'ADSET_PAUSED') return 'paused'
    if (u === 'COMPLETED') return 'completed'
    if (u === 'ARCHIVED') return 'archived'
    if (u === 'DELETED' || u === 'REMOVED' || u === '4') return 'deleted'
    return 'unknown'
  }

  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface" style={{ width: '140px', minWidth: '140px', maxWidth: '140px' }}>{nameLabel}</th>
            {platform === 'combined' && level === 'campaigns' && <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Platform</th>}
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Status</th>
            {level === 'ads' && <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider hidden md:table-cell">Copy</th>}
            {visibleCols.map(col => (
              <th key={col.id} onClick={() => handleSort(col.id)}
                className="text-right px-3 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none whitespace-nowrap">
                {col.label}{sortCol === col.id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
            {level !== 'ads' && <th className="px-3 py-3 w-8 text-left font-mono text-xs text-muted">↳</th>}
            {clientId && <th className="px-2 py-3 w-6" title="Ask Lora">✦</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row: any) => {
            const isSelected = selectedId === row.id
            return (
              <tr key={row.id + (row.platform || '')}
                onClick={() => onRowSelect && onRowSelect(row)}
                className={'table-row ' + (onRowSelect ? 'cursor-pointer ' : '') + (isSelected ? 'bg-blue-50' : 'hover:bg-surface')}>
                <td className={'px-3 py-3 font-medium truncate sticky left-0 ' + (isSelected ? 'bg-blue-50' : 'bg-white')}
                  style={{ width: '140px', minWidth: '140px', maxWidth: '140px' }}>
                  {level !== 'ads' ? (
                    <button
                      onClick={e => { e.stopPropagation(); onRowClick(row) }}
                      className="text-accent hover:underline text-left truncate max-w-full font-medium">
                      {row.name}
                    </button>
                  ) : (
                    <span>{row.name}</span>
                  )}
                </td>
                {platform === 'combined' && level === 'campaigns' && (
                  <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-muted">{row.platform === 'google' ? '🔵' : '🔷'}</td>
                )}
                <td className="px-3 py-3 whitespace-nowrap"><StatusBadge status={normalizeStatus(row.status)} /></td>
                {level === 'ads' && <td className="px-3 py-3 text-xs text-muted max-w-xs truncate hidden md:table-cell">{row.description || row.body || ''}</td>}
                {visibleCols.map(col => (
                  <td key={col.id} className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
                    {formatValue(col.id, col.getValue(row))}
                  </td>
                ))}
                {clientId && openPanel && (
                  <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                    <AskClaudeButton row={row} level={level} platform={platform}
                      clientId={clientId} clientName={clientName || ''} dateRange={dateRange || 'LAST_30_DAYS'}
                      openPanel={openPanel} />
                  </td>
                )}
              </tr>
            )
          })}
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
              {level !== 'ads' && <td className="px-3 py-3" />}
              {clientId && <td className="px-2 py-3" />}            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────
function Breadcrumb({ drill, onNavigate, onBack, dateLabel }: { drill: DrillState; onNavigate: (level: DrillLevel) => void; onBack: () => void; dateLabel?: string }) {
  if (drill.level === 'campaigns') return null
  return (
    <div className="flex items-center gap-2 mb-4 text-xs font-mono flex-wrap">
      {/* Mobile-only explicit back button */}
      <button
        onClick={onBack}
        className="md:hidden flex items-center gap-1 text-accent hover:bg-blue-50 px-2 py-1 -ml-2 rounded transition-colors"
        aria-label="Back"
      >
        <span className="text-base leading-none">←</span>
        <span className="font-medium">Back</span>
      </button>
      <span className="md:hidden text-muted">·</span>
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
          <button onClick={() => onNavigate('adgroups')} className="text-accent hover:underline">
            {drill.campaign?.platform === 'meta' ? 'Ad Sets' : 'Ad Groups'}
          </button>
          <span className="text-muted">›</span>
          <span className="text-ink font-medium truncate max-w-xs">{drill.adGroup.name}</span>
        </>
      )}
      {dateLabel && (
        <>
          <span className="text-muted ml-auto">·</span>
          <span className="text-muted">{dateLabel}</span>
        </>
      )}
    </div>
  )
}

// ─── Insight Chat Component ───────────────────────────────────────────────────
type InsightMessage = { role: 'user' | 'assistant'; content: string }

function InsightChat({ data, clientId, clientName, dateRange, customStart, customEnd, location, shopify }: {
  data?: PlatformData | null; clientId: string; clientName: string; dateRange: string; customStart?: string; customEnd?: string; location?: string; shopify?: any  // LORAMER_CUSTOM_DATE_RANGE_FIX_V2
}) {
  // Work with whatever data we have — ads, shopify, or both
  const hasAdData = !!(data?.totals && data?.campaigns)
  const hasShopifyData = !!(shopify?.connected)
  if (!hasAdData && !hasShopifyData) return null

  const totals = data?.totals
  const campaigns = data?.campaigns || []
  const platform = data?.platform || 'google'
  const cacheKey = 'advar-insight-' + clientId + '-' + platform + '-' + dateRange + '-' + (location || 'overview')
  const locationKey = (location || 'overview') + '-' + platform
  const [insight, setInsight] = useState<string>(() => {
    try { const c = lsJson(cacheKey, null) as any; if (c?.text && c?.ts && (Date.now() - c.ts) < 3600000) return c.text } catch {} return ''
  })
  const [loading, setLoading] = useState(!insight)
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<InsightMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [persisting, setPersisting] = useState(false)
  const [userNotes, setUserNotes] = useState<string>("")

  const anomalies: string[] = []
  if (hasAdData) {
    if (totals?.roas !== null && totals?.roas !== undefined && totals.roas < 0.5 && (totals.spend || 0) > 100) anomalies.push('ROAS is critically low at ' + fmt(totals.roas, 'multiplier'))
    const pausedWithSpend = campaigns.filter(c => c?.status === 'paused' && (c?.spend || 0) > 500)
    if (pausedWithSpend.length > 0) anomalies.push(pausedWithSpend.length + ' paused campaign(s) recorded spend')
  }
  if (hasShopifyData && shopify?.totalOrders === 0) anomalies.push('No orders recorded in this date range')
  const filteredAnomalies = filterAnomalies(anomalies, userNotes); const hasAnomalies = filteredAnomalies.length > 0

  async function fetchInsight(history: InsightMessage[] = []) {
    try {
      const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientName, dateRange, customStart, customEnd, location, conversationHistory: history, activeAlerts: filteredAnomalies,
          // Pass ad data if available for backwards compat
          totals: totals || null, campaigns: campaigns || [], platform }) }) // LORAMER_CUSTOM_DATE_RANGE_FIX_V2
      const d = await res.json(); return d.insight || ''
    } catch { return '' }
  }

  // LORAMER_CONV_API_V1_INSIGHTCHAT
  // LORAMER_ALLSURFACE_SCROLL_V1 - scroll insight chat to bottom on load/new message (mirrors ChatTab)
  const insightScrollRef = useRef<HTMLDivElement>(null)
  const insightMountedRef = useRef(false)
  useLayoutEffect(() => {
    const el = insightScrollRef.current
    if (!el) return
    if (!insightMountedRef.current) {
      el.scrollTop = el.scrollHeight
      insightMountedRef.current = true
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages.length, expanded])
  // Load saved conversation from client_conversations table on mount.
  // user_notes still lives on client_context, fetched separately.
  useEffect(() => {
    if (!clientId) return
    // Fetch user_notes from client_context
    fetch('/api/context?clientId=' + clientId)
      .then(r => r.json())
      .then(d => { setUserNotes(d.context?.user_notes || "") })
      .catch(() => {})
    // Fetch conversation messages from client_conversations
    const params = new URLSearchParams({
      clientId,
      surface: 'insight-chat',
      scope: locationKey,
    })
    fetch('/api/conversations?' + params.toString())
      .then(r => r.json())
      .then(d => {
        const msgs = (d.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
        if (msgs.length > 0) {
          setMessages(msgs)
          setExpanded(true)
        }
      })
      .catch(() => {})
  }, [clientId, locationKey])

  useEffect(() => {
    fetchInsight().then(text => { if (text) { setInsight(text); lsSet(cacheKey, JSON.stringify({ text, ts: Date.now() })) } setLoading(false) })
  }, [clientId, platform, dateRange, location])

  // LORAMER_CONV_API_V1_INSIGHTCHAT + LORAMER_MEMORY_AUTODETECT_V1
  async function saveConversation(updatedMessages: InsightMessage[]) {
    if (!clientId) return
    setPersisting(true)
    try {
      if (updatedMessages.length === 0) {
        const params = new URLSearchParams({
          clientId,
          surface: 'insight-chat',
          scope: locationKey,
        })
        await fetch('/api/conversations?' + params.toString(), { method: 'DELETE' })
      } else if (updatedMessages.length >= 2) {
        const newPair = updatedMessages.slice(-2)
        for (const m of newPair) {
          const r = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId,
              surface: 'insight-chat',
              scope: locationKey,
              role: m.role,
              content: m.content,
            }),
          })
          if (m.role === 'user') {
            const d = await r.json().catch(() => ({}))
            if (d?.proposeMemory && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('loramer-memory-proposal', {
                detail: { clientId, proposal: d.proposeMemory, originalMessage: m.content },
              }))
            }
          }
        }
      }
      // Invalidate other insight caches so they re-fetch with this new context
      // but keep THIS box's cache since we just updated it
      if (typeof window !== 'undefined') {
        Object.keys(localStorage)
          .filter(k => k.startsWith('advar-insight-' + clientId + '-') && k !== cacheKey)
          .forEach(k => localStorage.removeItem(k))
      }
    } catch {} finally { setPersisting(false) }
  }

  const [profileSuggestion, setProfileSuggestion] = useState<string>('')
  const [profileSaved, setProfileSaved] = useState(false)

  async function extractProfileContext(conversation: InsightMessage[]) {
    // Ask Claude to extract any persistent context from the conversation
    try {
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totals, campaigns, platform, dateRange, customStart, customEnd, clientName, clientId,
          conversationHistory: [
            ...conversation,
            { role: 'user', content: 'Based on what the user just told you, extract any persistent facts about this client that should always inform your future analysis. Examples: "ignore ROAS", "focus on MoF conversions", "target CPA is $45", "this is a top-of-funnel brand awareness account". Reply with ONLY the key facts as a single short sentence, or reply with exactly "none" if there is nothing new worth saving.' }
          ],
          location,
          // LORAMER_CUSTOM_DATE_RANGE_FIX_V2
        }),
      })
      const d = await res.json()
      const suggestion = (d.insight || '').trim()
      if (suggestion && suggestion.toLowerCase() !== 'none' && suggestion.length > 5) {
        // Don't surface a suggestion if it's already in user_notes (case-insensitive, normalized)
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
        const existingNorm = norm(userNotes || '')
        const suggestionNorm = norm(suggestion)
        if (existingNorm.includes(suggestionNorm)) return
        setProfileSuggestion(suggestion)
      }
    } catch {}
  }

  async function saveToProfile() {
    if (!profileSuggestion) return
    try {
      // Fetch existing notes and append
      const r = await fetch('/api/context?clientId=' + clientId)
      const d = await r.json()
      const existing = d.context?.user_notes || ''
      // Dedup: if the suggestion (or close match) is already in user_notes, skip the write.
      // Normalize both sides — case-insensitive, collapse whitespace — to catch near-duplicates.
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
      const existingNorm = norm(existing)
      const suggestionNorm = norm(profileSuggestion)
      if (suggestionNorm && existingNorm.includes(suggestionNorm)) {
        // Already saved — just dismiss the suggestion UI
        setProfileSuggestion('')
        setProfileSaved(true)
        setTimeout(() => setProfileSaved(false), 3000)
        return
      }
      const updated = existing ? existing + '\n' + profileSuggestion : profileSuggestion
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, updates: { user_notes: updated } })
      })
      setProfileSuggestion('')
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch {}
  }

  async function sendMessage() {
    if (!input.trim()) return
    const userMsg = input.trim(); setInput(''); setSending(true)
    const openingMessage = insight || filteredAnomalies.map(a => '⚠ ' + a).join('. ')
    const history: InsightMessage[] = [{ role: 'assistant', content: openingMessage }, ...messages, { role: 'user', content: userMsg }]
    const newMessages = [...messages, { role: 'user' as const, content: userMsg }]
    setMessages(newMessages)
    const reply = await fetchInsight(history)
    const finalMessages = [...newMessages, { role: 'assistant' as const, content: reply }]
    setMessages(finalMessages)
    setSending(false)
    saveConversation(finalMessages)
    // Check if user shared anything worth saving to profile
    extractProfileContext(finalMessages)
    setTimeout(() => {
      const el = document.getElementById('it-' + cacheKey) || document.getElementById('it-amber-' + cacheKey)
      if (el) el.scrollTop = el.scrollHeight
    }, 100)
  }

  return (
    <div className="border bg-blue-50 border-blue-200 rounded-xl overflow-hidden">
      <div className="px-4 md:px-6 py-4 md:py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            {hasAnomalies && (
              <div className="mb-3 pb-3 border-b border-blue-200">
                <p className="font-mono text-xs uppercase tracking-widest mb-1.5 text-amber-600">⚠ Attention needed</p>
                <div className="space-y-0.5">{filteredAnomalies.map((a, i) => <p key={i} className="text-sm text-amber-800 font-medium">• {a}</p>)}</div>
              </div>
            )}
            <p className="font-mono text-xs uppercase tracking-widest mb-2 text-accent">✦ Lora Analysis</p>
            {loading && !insight
              ? <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" /><span className="text-sm text-muted font-mono">Analyzing account...</span></div>
              : <div className="chat-response text-sm text-ink leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]}>{insight}</ReactMarkdown></div>}
          </div>
          {insight && !loading && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {persisting && <span className="text-xs font-mono text-muted animate-pulse">saving...</span>}
              <button onClick={() => setExpanded(!expanded)}
                className="text-xs font-mono text-accent hover:text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg bg-white transition-colors whitespace-nowrap">
                {expanded ? '↑ Close' : messages.length > 0 ? '↓ ' + Math.floor(messages.length / 2) + ' replies' : '↓ Reply'}
              </button>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-blue-200 bg-white">
          <div className="px-4 py-2 flex items-center justify-between border-b border-blue-100">
            <span className="text-xs font-mono text-muted">{Math.floor(messages.length / 2)} exchange{Math.floor(messages.length / 2) !== 1 ? 's' : ''}</span>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); saveConversation([]) }}
                className="text-xs font-mono text-muted hover:text-red-500 transition-colors">
                × Clear
              </button>
            )}
          </div>
          {messages.length > 0 && (
            <div ref={insightScrollRef} id={'it-' + cacheKey} className="max-h-64 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={'text-sm px-3 py-2 rounded-xl max-w-[85%] ' + (m.role === 'user' ? 'bg-accent text-white' : 'bg-blue-50 text-ink border border-blue-100')}>{m.role === 'user' ? m.content : <div className="chat-response prose prose-sm max-w-none">{/* LORAMER_INSIGHTCHAT_MARKDOWN_V1 */}<ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>}</div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start"><div className="bg-blue-50 border border-blue-100 px-3 py-2 rounded-xl">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div></div>
              )}
            </div>
          )}
          <div className="px-4 py-3 flex gap-2 border-t border-blue-100">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !sending && sendMessage()}
              placeholder="Add context or ask a follow-up..." disabled={sending}
              className="flex-1 text-sm border border-blue-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-accent disabled:opacity-50" />
            <button onClick={sendMessage} disabled={sending || !input.trim()} className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">Send</button>
          </div>
          {profileSuggestion && (
            <div className="px-4 py-3 bg-blue-50 border-t border-blue-100 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-mono text-accent mb-0.5">✦ Save to client profile?</p>
                <p className="text-xs text-ink">"{profileSuggestion}"</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={saveToProfile} className="text-xs font-mono bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">Save</button>
                <button onClick={() => setProfileSuggestion('')} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 rounded-lg transition-colors">Dismiss</button>
              </div>
            </div>
          )}
          {profileSaved && (
            <div className="px-4 py-2 bg-green-50 border-t border-green-100">
              <p className="text-xs font-mono text-green-600">✓ Saved to client profile — Lora will use this for all future analyses</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Shopify Chart ────────────────────────────────────────────────────────────
const SHOPIFY_METRICS = [
  { id: 'revenue', label: 'Revenue', currency: true, color: '#16a34a' },
  { id: 'orders', label: 'Orders', color: '#2563eb' },
  { id: 'avgOrderValue', label: 'AOV', currency: true, color: '#9333ea' },
]

function ShopifyChart({ clientId, dateRange, customStart, customEnd, apiPath = '/api/shopify/daily' }: {  // LORAMER_WOO_TAB_V1
  clientId: string; dateRange: string; customStart?: string; customEnd?: string; apiPath?: string  // LORAMER_WOO_TAB_V1
}) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['revenue', 'orders'])

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    let url = `${apiPath}?clientId=${clientId}&dateRange=${dateRange}`  // LORAMER_WOO_TAB_V1
    if (customStart) url += '&customStart=' + customStart
    if (customEnd) url += '&customEnd=' + customEnd
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d.daily || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, dateRange, customStart, customEnd])

  const toggle = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])

  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!data.length) return null

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Store Performance Over Time</h3>
        <div className="flex gap-1 flex-wrap">
          {SHOPIFY_METRICS.map(m => (
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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {SHOPIFY_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}


function AskClaudeCardButton({ cardTitle, cardData, clientId, clientName, platform, dateRange, openPanel }: {
  cardTitle: string; cardData: string
  clientId: string; clientName: string; platform: Platform; dateRange: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[], quickPrompts?: string[]) => void
}) {
  // LORAMER_PANEL_ONLY_V1 - thin wrapper, opens RightPanel with card context and quick prompts
  // LORAMER_CARD_PROMPTS_V2
  // NOTE: when adding a new platform (Amazon, TikTok, etc.) that introduces new
  // dashboard card titles, add the card-specific quick prompts here. Without an
  // entry, the card falls through to the generic prompts at the bottom.
  const quickPromptsByCard: Record<string, string[]> = {
    // Google / Meta ad platform cards
    'Campaign Performance': ['Which campaign should get more budget?', "What's underperforming here?", 'Any quick wins?'],
    'Conversion Leaders': ['Why is the top campaign converting so well?', 'How do I replicate this?', 'Is my CPA healthy?'],
    'Budget Utilization': ['Am I overspending anywhere?', 'Should I adjust any budgets?', 'Where should I reallocate?'],
    'Top Keywords': ['Any wasted spend here?', 'Which keywords should I pause?', "What's my best keyword?"],
    'Top Keywords by Spend': ['Any wasted spend here?', 'Which keywords should I pause?', "What's my best keyword?"],
    // Shopify / WooCommerce e-commerce cards (shared titles render on both tabs)
    'Top Products': ['Which products are driving the most growth?', "What's underperforming and why?", 'Any product mix risks?'],
    'Top Products by Revenue': ['Which products are driving the most growth?', "What's underperforming and why?", 'Any product mix risks?'],
    'Customer Mix': ['Is my new vs returning ratio healthy?', 'How do I attract more new customers?', 'What does my retention say about my brand?'],
    'Revenue Summary': ['Is my AOV trending in the right direction?', 'How does revenue per customer compare to industry?', 'Where is growth coming from?'],
  }
  const quickPrompts = quickPromptsByCard[cardTitle] || ['Tell me more about this', 'Any recommendations?', 'What should I do next?']
  const cardContext = 'Overview page — ' + cardTitle + ' card:\n' + cardData

  return (
    <button
      onClick={() => openPanel(cardTitle, cardContext, [], quickPrompts)}
      title={'Ask Lora about ' + cardTitle}
      className="text-xs text-accent hover:bg-blue-100 transition-colors px-1.5 py-0.5 rounded"
    >
      ✦
    </button>
  )
}

function formatEngagementRate(rate: number | undefined): string {
  if (rate == null) return '—'
  const pct = rate <= 1 ? rate * 100 : rate
  return fmt(pct, 'percent')
}

// LORAMER_GA_OVERVIEW_COMBINED_V1
function GaCombinedMetrics({ ga }: { ga: IntelligenceGa }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white border border-border p-4">
        <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">📊 GA Sessions</p>
        <p className="text-2xl font-display text-accent">{ga.sessions != null ? fmt(ga.sessions) : '—'}</p>
      </div>
      <div className="bg-white border border-border p-4">
        <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">📊 GA Users</p>
        <p className="text-2xl font-display text-accent">{ga.totalUsers != null ? fmt(ga.totalUsers) : '—'}</p>
      </div>
    </div>
  )
}

// LORAMER_GA_OVERVIEW_COMBINED_V1
function GaOverviewSummary({ ga, clientId, clientName, platform, dateRange, openPanel }: {
  ga: IntelligenceGa
  clientId: string
  clientName: string
  platform: Platform
  dateRange: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
}) {
  const metrics = [
    { label: 'Sessions', value: ga.sessions != null ? fmt(ga.sessions) : '—' },
    { label: 'Total Users', value: ga.totalUsers != null ? fmt(ga.totalUsers) : '—' },
    { label: 'Engagement Rate', value: formatEngagementRate(ga.engagementRate) },
    { label: 'Conversions', value: ga.conversions != null ? fmt(ga.conversions) : '—' },
  ]
  const topSources = (ga.topTrafficSources || []).slice(0, 5)
  const gaContext = metrics.map(m => m.label + ': ' + m.value).join(', ')
    + (topSources.length > 0
      ? '\nTop sources:\n' + topSources.map(s => s.source + ' / ' + s.medium + ': ' + s.sessions + ' sessions').join('\n')
      : '')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="metric-label mb-1 md:mb-2 text-xs">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>
      {topSources.length > 0 && (
        <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs tracking-widest uppercase text-muted">📊 Top Traffic Sources</h3>
            <AskClaudeCardButton cardTitle="Google Analytics Traffic Sources"
              cardData={gaContext}
              clientId={clientId} clientName={clientName} platform={platform} dateRange={dateRange} openPanel={openPanel} />
          </div>
          <div className="space-y-2">
            {topSources.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                <span className="text-xs text-ink truncate max-w-[60%]">{s.source} / {s.medium}</span>
                <span className="text-xs font-mono text-muted">{fmt(s.sessions)} sessions</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ data, googleAccountId, metaAccountId, dateRange, clientId, clientName, customStart, customEnd, openPanel, shopify, ga, hasGa }: {
  data?: PlatformData | null; googleAccountId: string; metaAccountId: string; dateRange: string; clientId: string; clientName: string; customStart?: string; customEnd?: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
  shopify?: any
  ga?: IntelligenceGa | null
  hasGa?: boolean
}) {
  const totals = data?.totals
  const campaigns = data?.campaigns || []
  const platform = data?.platform || 'google'
  const hasAdData = !!(data?.totals && data?.campaigns)  // empty array = zero-spend, render zeros
  const metrics = hasAdData ? [
    { label: 'Total Spend', value: fmt(totals!.spend, 'currency') },
    { label: 'Clicks', value: fmt(totals!.clicks) },
    { label: 'Impressions', value: fmt(totals!.impressions) },
    { label: 'Conversions', value: fmt(totals!.conversions, 'decimal') },
    { label: 'ROAS', value: totals!.roas ? fmt(totals!.roas, 'multiplier') : '—' },
    { label: 'Avg CTR', value: fmt(totals!.avgCtr, 'percent') },
  ] : []
  const topByCost = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5)
  const topByConv = [...campaigns].filter(c => c.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 5)
  const maxCost = topByCost.length > 0 ? topByCost[0].spend : 1
  const campaignsWithBudget = campaigns.filter(c => c.budget && c.budget > 0).slice(0, 5)
  const [keywordCardData, setKeywordCardData] = useState('Loading keyword data...')

  return (
    <div className="space-y-4 md:space-y-6">
      <InsightChat data={data} clientId={clientId} clientName={clientName} dateRange={dateRange} customStart={customStart} customEnd={customEnd} location="overview" shopify={shopify} />

      {hasAdData && platform === 'combined' && totals!.googleSpend !== undefined && totals!.metaSpend !== undefined && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-border p-4">
            <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">🔵 Google Ads</p>
            <p className="text-2xl font-display text-accent">{fmt(totals!.googleSpend, 'currency')}</p>
          </div>
          <div className="bg-white border border-border p-4">
            <p className="font-mono text-xs text-muted uppercase tracking-wider mb-1">🔷 Meta Ads</p>
            <p className="text-2xl font-display text-accent">{fmt(totals!.metaSpend, 'currency')}</p>
          </div>
        </div>
      )}

      {/* LORAMER_GA_OVERVIEW_COMBINED_V1 — compact GA alongside combined ad metrics */}
      {hasGa && ga?.connected && hasAdData && platform === 'combined' && (
        <GaCombinedMetrics ga={ga} />
      )}

      {hasAdData && metrics.length > 0 && (
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="metric-label mb-1 md:mb-2 text-xs">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>
      )}

      {hasAdData && platform === 'google' && googleAccountId && <GoogleChart accountId={googleAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {hasAdData && platform === 'meta' && metaAccountId && <MetaChart accountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {hasAdData && platform === 'combined' && googleAccountId && metaAccountId && <CombinedChart googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}
      {shopify?.connected && clientId && <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />}

      {hasAdData && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4 flex items-center justify-between">
              Campaign Performance
              <AskClaudeCardButton cardTitle="Campaign Performance"
                cardData={topByCost.map(c => `${c.name}: $${c.spend.toFixed(2)} spend, ${c.conversions.toFixed(1)} conv, ROAS ${c.roas ? c.roas.toFixed(2) + 'x' : 'N/A'}, CTR ${c.ctr?.toFixed(2)}%`).join('\n')}
                clientId={clientId} clientName={clientName} platform={platform} dateRange={dateRange} openPanel={openPanel} />
            </h3>
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
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4 flex items-center justify-between">
              Conversion Leaders
              <AskClaudeCardButton cardTitle="Conversion Leaders"
                cardData={topByConv.map(c => `${c.name}: ${c.conversions.toFixed(1)} conv, CPA ${c.costPerConv ? '$' + c.costPerConv.toFixed(2) : 'N/A'}, ROAS ${c.roas ? c.roas.toFixed(2) + 'x' : 'N/A'}`).join('\n')}
                clientId={clientId} clientName={clientName} platform={platform} dateRange={dateRange} openPanel={openPanel} />
            </h3>
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Top Keywords</h3>
              {clientId && <AskClaudeCardButton cardTitle="Top Keywords" cardData={keywordCardData} clientId={clientId} clientName={clientName} platform={platform} dateRange={dateRange} openPanel={openPanel} />}
            </div>
            <TopKeywordsCard accountId={googleAccountId} dateRange={dateRange} onDataLoaded={setKeywordCardData} />
          </div>
        )}
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4 flex items-center justify-between">
              Budget Utilization
              <AskClaudeCardButton cardTitle="Budget Utilization"
                cardData={campaignsWithBudget.map(c => `${c.name}: $${c.spend.toFixed(2)} spent of $${c.budget?.toFixed(2)}/day budget (${((c.spend / (c.budget! * 30)) * 100).toFixed(0)}% utilized)`).join('\n')}
                clientId={clientId} clientName={clientName} platform={platform} dateRange={dateRange} openPanel={openPanel} />
            </h3>
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
      )} {/* end hasAdData */}

      {/* Shopify summary cards — show when Shopify is connected */}
      {shopify?.connected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs tracking-widest uppercase text-muted">🛍 Shopify Revenue</h3>
              <AskClaudeCardButton cardTitle="Shopify Revenue"
                cardData={`Shopify: $${(shopify.totalRevenue || 0).toFixed(2)} revenue, ${shopify.totalOrders || 0} orders, $${(shopify.avgOrderValue || 0).toFixed(2)} AOV`}
                clientId={clientId} clientName={clientName} platform={data?.platform || 'google'} dateRange={dateRange} openPanel={openPanel} />
            </div>
            <div className="space-y-2">
              {[
                { label: 'Total Revenue', value: fmt(shopify.totalRevenue || 0, 'currency') },
                { label: 'Total Orders', value: fmt(shopify.totalOrders || 0) },
                { label: 'Avg Order Value', value: fmt(shopify.avgOrderValue || 0, 'currency') },
              ].map(m => (
                <div key={m.label} className="flex justify-between py-1 border-b border-border last:border-0">
                  <span className="text-xs text-muted">{m.label}</span>
                  <span className="text-xs font-mono text-ink">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs tracking-widest uppercase text-muted">🛍 Shopify Customers</h3>
              <AskClaudeCardButton cardTitle="Shopify Customers"
                cardData={`Shopify customers: ${shopify.newCustomers || 0} new, ${shopify.returningCustomers || 0} returning`}
                clientId={clientId} clientName={clientName} platform={data?.platform || 'google'} dateRange={dateRange} openPanel={openPanel} />
            </div>
            <div className="space-y-2">
              {[
                { label: 'New Customers', value: fmt(shopify.newCustomers || 0) },
                { label: 'Returning Customers', value: fmt(shopify.returningCustomers || 0) },
                { label: 'Return Rate', value: shopify.totalOrders > 0 ? fmt(((shopify.returningCustomers || 0) / shopify.totalOrders) * 100, 'percent') : '—' },
              ].map(m => (
                <div key={m.label} className="flex justify-between py-1 border-b border-border last:border-0">
                  <span className="text-xs text-muted">{m.label}</span>
                  <span className="text-xs font-mono text-ink">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* LORAMER_GA_OVERVIEW_COMBINED_V1 — summary GA section on Overview */}
      {hasGa && ga?.connected && (
        <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">📊 Google Analytics</h3>
          <GaOverviewSummary
            ga={ga}
            clientId={clientId}
            clientName={clientName}
            platform={platform}
            dateRange={dateRange}
            openPanel={openPanel}
          />
        </div>
      )}
    </div>
  )
}

function TopKeywordsCard({ accountId, dateRange, onDataLoaded }: { accountId: string; dateRange: string; onDataLoaded?: (data: string) => void }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'cost' | 'clicks' | 'ctr' | 'conversions' | 'qualityScore'>('cost')

  const sortOptions = [
    { value: 'cost', label: 'Spend' },
    { value: 'clicks', label: 'Clicks' },
    { value: 'ctr', label: 'CTR' },
    { value: 'conversions', label: 'Conversions' },
    { value: 'qualityScore', label: 'Quality Score' },
  ]

  useEffect(() => {
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json()).then(d => {
        setKeywords(d.keywords || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [accountId, dateRange])

  const sorted = [...keywords].sort((a, b) => Number(b[sortBy] || 0) - Number(a[sortBy] || 0)).slice(0, 5)

  useEffect(() => {
    if (onDataLoaded && sorted.length > 0) {
      const sortLabel = sortOptions.find(o => o.value === sortBy)?.label || 'Spend'
      onDataLoaded(`Top keywords by ${sortLabel}:\n` + sorted.map((k: any) => `${k.text}: $${k.cost} spend, ${k.clicks} clicks, ${k.ctr}% CTR, QS ${k.qualityScore || 'N/A'}, conv: ${k.conversions || 0}`).join('\n'))
    }
  }, [sortBy, keywords])

  const formatValue = (k: any) => {
    if (sortBy === 'cost') return '$' + k.cost
    if (sortBy === 'ctr') return k.ctr + '%'
    if (sortBy === 'qualityScore') return k.qualityScore || '—'
    return k[sortBy] || '—'
  }

  if (loading) return <p className="text-xs text-muted font-mono">Loading...</p>
  if (!keywords.length) return <p className="text-xs text-muted font-mono">No keyword data</p>
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-xs text-muted font-mono">Sort by</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="text-xs border border-border rounded px-1.5 py-0.5 bg-paper text-ink font-mono focus:outline-none focus:border-accent">
          {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {sorted.map((k: any, i: number) => (
          <div key={i} className="flex items-center justify-between py-1 border-b border-border last:border-0">
            <span className="text-xs text-ink truncate max-w-[60%]">{k.text}</span>
            <span className="text-xs font-mono text-muted">{formatValue(k)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Campaigns Tab with Drill-down ────────────────────────────────────────────
function CampaignsTab({ data, googleAccountId, metaAccountId, dateRange, clientId, clientName, customStart, customEnd, openPanel }: {
  data: PlatformData; googleAccountId: string; metaAccountId: string; dateRange: string; clientId: string; clientName: string; customStart?: string; customEnd?: string
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
}) {
  const dateLabel = dateRange === 'CUSTOM' && customStart && customEnd ? customStart + ' – ' + customEnd : (dateRange === 'LAST_7_DAYS' ? 'Last 7 days' : dateRange === 'LAST_14_DAYS' ? 'Last 14 days' : dateRange === 'LAST_30_DAYS' ? 'Last 30 days' : dateRange === 'LAST_90_DAYS' ? 'Last 90 days' : dateRange === 'THIS_MONTH' ? 'This month' : dateRange === 'LAST_MONTH' ? 'Last month' : dateRange)
  const { campaigns, platform } = data
  const storageKey = 'advar-cols-' + platform
  const defaultCols = COLUMN_DEFS.filter(c => c.platforms.includes(platform) && c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => lsJson(storageKey, defaultCols))

  const [drill, setDrill] = useState<DrillState>(() => lsJson('advar-drill-state', { level: 'campaigns', campaign: null, adGroup: null }))
  const [subRows, setSubRows] = useState<any[]>([])
  const [subLoading, setSubLoading] = useState(false)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')

  function saveDrill(d: DrillState) {
    setDrill(d)
    lsSet('advar-drill-state', JSON.stringify(d))
  }

  const updateCols = (cols: string[]) => { setActiveCols(cols); lsSet(storageKey, JSON.stringify(cols)) }

  async function drillIntoCampaign(campaign: any, opts: { skipHistory?: boolean } = {}) {
    const campaignPlatform: 'google' | 'meta' = campaign.platform || (platform === 'combined' ? 'google' : platform as 'google' | 'meta')
    const newDrill: DrillState = { level: 'adgroups', campaign: { id: campaign.id, name: campaign.name, platform: campaignPlatform }, adGroup: null }
    saveDrill(newDrill)
    if (!opts.skipHistory && typeof window !== 'undefined') {
      window.history.pushState({ drillLevel: 'adgroups', campaignId: campaign.id }, '', window.location.pathname + window.location.search)
    }
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

  async function drillIntoAdGroup(adGroup: any, opts: { skipHistory?: boolean } = {}) {
    const newDrill: DrillState = { ...drill, level: 'ads', adGroup: { id: adGroup.id, name: adGroup.name } }
    saveDrill(newDrill)
    if (!opts.skipHistory && typeof window !== 'undefined') {
      window.history.pushState({ drillLevel: 'ads', adGroupId: adGroup.id }, '', window.location.pathname + window.location.search)
    }
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
      drillIntoCampaign(drill.campaign, { skipHistory: true })
    }
  }

  // Back navigation — goes UP one drill level. Hooked to both the mobile back
  // button and the iOS browser back gesture via popstate.
  function goBack() {
    if (drill.level === 'ads' && drill.campaign) {
      // ads → adgroups
      drillIntoCampaign(drill.campaign, { skipHistory: true })
    } else if (drill.level === 'adgroups') {
      // adgroups → campaigns
      saveDrill({ level: 'campaigns', campaign: null, adGroup: null })
      setSubRows([])
    }
  }

  // On mount: restore data if drill state was persisted, and wire up popstate listener.
  useEffect(() => {
    if (drill.level === 'adgroups' && drill.campaign) {
      drillIntoCampaign(drill.campaign, { skipHistory: true })
    } else if (drill.level === 'ads' && drill.campaign && drill.adGroup) {
      drillIntoAdGroup(drill.adGroup, { skipHistory: true })
    }

    // popstate fires when user taps iOS browser back. Treat it as goBack.
    function handlePopState() { goBack() }
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopState)
      return () => window.removeEventListener('popstate', handlePopState)
    }
  }, [drill.level]) // eslint-disable-line

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

      <Breadcrumb drill={drill} onNavigate={navigateTo} onBack={goBack} dateLabel={dateLabel} />

      {clientId && (
        <div className="mb-4">
          <InsightChat
            data={data}
            clientId={clientId}
            clientName={clientName}
            dateRange={dateRange}
            customStart={customStart}
            customEnd={customEnd}
            location={
              drill.level === 'campaigns' ? 'campaigns' :
              drill.level === 'adgroups' ? 'adgroups:' + (drill.campaign?.name || '') :
              'ads:' + (drill.adGroup?.name || '')
            }
          />
        </div>
      )}

      {drill.level === 'campaigns' && platform === 'google' && googleAccountId && <GoogleChart accountId={googleAccountId} dateRange={dateRange} campaignId={selectedCampaignId || undefined} campaignName={selectedCampaignId ? (campaigns.find(c => c.id === selectedCampaignId)?.name) : undefined} customStart={customStart} customEnd={customEnd} />}
      {drill.level === 'campaigns' && platform === 'meta' && metaAccountId && <MetaChart accountId={metaAccountId} dateRange={dateRange} campaignId={selectedCampaignId || undefined} campaignName={selectedCampaignId ? (campaigns.find(c => c.id === selectedCampaignId)?.name) : undefined} customStart={customStart} customEnd={customEnd} />}
      {drill.level === 'campaigns' && platform === 'combined' && (() => {
        const selCampaign = campaigns.find(c => c.id === selectedCampaignId)
        if (selCampaign?.platform === 'google' && googleAccountId) {
          return <GoogleChart accountId={googleAccountId} dateRange={dateRange} campaignId={selCampaign.id} campaignName={selCampaign.name} customStart={customStart} customEnd={customEnd} />
        }
        if (selCampaign?.platform === 'meta' && metaAccountId) {
          return <MetaChart accountId={metaAccountId} dateRange={dateRange} campaignId={selCampaign.id} campaignName={selCampaign.name} customStart={customStart} customEnd={customEnd} />
        }
        return googleAccountId && metaAccountId ? <CombinedChart googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} /> : null
      })()}
      {drill.level === 'adgroups' && drill.campaign && (
        <AdGroupChart campaignId={drill.campaign.id} accountId={googleAccountId} dateRange={dateRange} platform={drill.campaign.platform} metaAccountId={metaAccountId} customStart={customStart} customEnd={customEnd} />
      )}
      {drill.level === 'ads' && subRows.length > 0 && drill.adGroup && (
        <AdChart ads={subRows} adGroupId={drill.adGroup.id}
          platform={drill.campaign?.platform || (platform === 'combined' ? 'google' : platform as 'google' | 'meta')}
          accountId={googleAccountId} metaAccountId={metaAccountId}
          dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
      )}

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
          onRowClick={drill.level === 'campaigns' ? drillIntoCampaign : drillIntoAdGroup}
          onRowSelect={drill.level === 'campaigns' ? (row) => setSelectedCampaignId(prev => prev === row.id ? '' : row.id) : undefined}
          selectedId={drill.level === 'campaigns' ? selectedCampaignId : undefined}
          clientId={clientId} clientName={clientName} dateRange={dateRange} openPanel={openPanel} />
      )}
    </div>
  )
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────
function KeywordsTab({ accountId, dateRange, clientId, clientName, platformData, customStart, customEnd }: { accountId: string; dateRange: string; clientId: string; clientName: string; platformData: PlatformData | null; customStart?: string; customEnd?: string  /* LORAMER_CUSTOM_DATE_RANGE_FIX_V2 */ }) {
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
      {clientId && platformData && (
        <div className="mb-4">
          <InsightChat data={platformData} clientId={clientId} clientName={clientName} dateRange={dateRange} customStart={customStart} customEnd={customEnd} location="keywords" />
        </div>
      )}
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
function ChatTab({ messages, input, loading, onInputChange, onSend, accountSelected, onDownload, onUpload, exchangeCount, platform, clientName, drillLevel }: any) {
  // LORAMER_ASKCLAUDE_SCROLL_V1 — scroll to bottom on mount (refresh case) and on new messages.
  // useLayoutEffect fires before paint so the user never sees the panel parked at the first message.
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const hasMountedRef = useRef(false)
  useLayoutEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    if (!hasMountedRef.current) {
      el.scrollTop = el.scrollHeight
      hasMountedRef.current = true
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages.length])
  // LORAMER_LIFT_CHAT_EXCHANGE_LIMIT_V1 - temporarily lifted until tier gating ships; original: `exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0`
  const atLimit = false
  // LORAMER_LIFT_CHAT_EXCHANGE_LIMIT_V1 - temporarily lifted; original: `exchangeCount % 4 === 3 && exchangeCount > 0 && messages.length > 0`
  const warningNext = false
  const platformLabel = platform === 'google' ? 'Google Ads' : platform === 'meta' ? 'Meta Ads' : 'all platforms'
  const chatLevelLabel = drillLevel === 'adgroups' ? ' · ad groups' : drillLevel === 'ads' ? ' · ads' : ''
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Ask Lora</h2>
          <p className="text-sm text-muted font-mono">{clientName} · {platformLabel}{chatLevelLabel}</p>
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
        <div ref={chatScrollRef} id="chat-messages" className="flex-1 p-4 md:p-6 space-y-4 overflow-y-auto">
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
// ─── Shopify Tab Component ────────────────────────────────────────────────────
// Displays Shopify store data: revenue, orders, products, customers
// Used when a client has Shopify connected (with or without ad platforms)

interface ShopifyData {
  connected: boolean
  totalOrders?: number
  totalRevenue?: number
  avgOrderValue?: number
  newCustomers?: number
  returningCustomers?: number
  topProducts?: { id: string; name: string; revenue: number; units: number }[]
  adAttributedRevenue?: number
  adAttributedOrders?: number
}

function ShopifyTab({ shopify, clientId, clientName, dateRange, platform, openPanel, platformLabel = 'Shopify', apiPath = '/api/shopify/daily', customStart, customEnd }: {  // LORAMER_WOO_TAB_V1 + LORAMER_CUSTOM_DATE_RANGE_FIX_V2
  shopify: ShopifyData
  clientId: string
  clientName: string
  dateRange: string
  platform: Platform
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
  platformLabel?: string  // LORAMER_WOO_TAB_V1
  apiPath?: string  // LORAMER_WOO_TAB_V1
  customStart?: string  // LORAMER_CUSTOM_DATE_RANGE_FIX_V2_SHOPIFY_TYPE
  customEnd?: string  // LORAMER_CUSTOM_DATE_RANGE_FIX_V2_SHOPIFY_TYPE
}) {
  if (!shopify) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-4">
        <p className="text-2xl">🛍</p>
        <p className="text-ink font-medium">{platformLabel} data unavailable</p>
        <p className="text-muted font-mono text-sm">Could not fetch store data. Check your {platformLabel} connection.</p>
        <a href="/clients" className="btn-primary text-sm">Manage connections →</a>
      </div>
    )
  }

  const metrics = [
    { label: 'Total Revenue', value: shopify.totalRevenue != null ? fmt(shopify.totalRevenue, 'currency') : '—' },
    { label: 'Total Orders', value: shopify.totalOrders != null ? fmt(shopify.totalOrders) : '—' },
    { label: 'Avg Order Value', value: shopify.avgOrderValue != null ? fmt(shopify.avgOrderValue, 'currency') : '—' },
    { label: 'New Customers', value: shopify.newCustomers != null ? fmt(shopify.newCustomers) : '—' },
    { label: 'Returning', value: shopify.returningCustomers != null ? fmt(shopify.returningCustomers) : '—' },
    { label: 'Return Rate', value: shopify.totalOrders && shopify.returningCustomers != null ? fmt((shopify.returningCustomers / shopify.totalOrders) * 100, 'percent') : '—' },
  ]

  const topProducts = shopify.topProducts || []
  const maxRevenue = topProducts[0]?.revenue || 1
  const shopifyContext = `${platformLabel} store data for ${clientName}:
Total Revenue: ${shopify.totalRevenue != null ? '$' + shopify.totalRevenue.toFixed(2) : 'N/A'}
Total Orders: ${shopify.totalOrders || 0}
Avg Order Value: ${shopify.avgOrderValue != null ? '$' + shopify.avgOrderValue.toFixed(2) : 'N/A'}
New Customers: ${shopify.newCustomers || 0}
Returning Customers: ${shopify.returningCustomers || 0}
${topProducts.length > 0 ? 'Top Products:\n' + topProducts.slice(0, 5).map(p => `- ${p.name}: $${p.revenue.toFixed(2)} revenue, ${p.units} units`).join('\n') : ''}`

  return (
    <div className="space-y-4 md:space-y-6">
      {/* LORAMER_SHOPIFY_INSIGHT_V1 - Claude analysis banner, matches Overview/Campaigns/Keywords pattern */}
      {clientId && (
        <InsightChat
          clientId={clientId}
          clientName={clientName}
          dateRange={dateRange}
          customStart={customStart}
          customEnd={customEnd}
          location={platformLabel.toLowerCase()}
          shopify={shopify}
        />
      )}
      {/* Revenue over time chart */}
      {/* LORAMER_WOO_FIX_V2 */}
      <ShopifyChart clientId={clientId} dateRange={dateRange} customStart={undefined} customEnd={undefined} apiPath={apiPath} />

      {/* Metric tiles */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border rounded-xl overflow-hidden">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="text-xs font-medium text-muted uppercase tracking-widest mb-1 md:mb-2">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Top Products by Revenue</h3>
            <AskClaudeCardButton
              cardTitle="Top Products"
              cardData={shopifyContext}
              clientId={clientId}
              clientName={clientName}
              platform={platform}
              dateRange={dateRange}
              openPanel={openPanel}
            />
          </div>
          <div className="space-y-3">
            {topProducts.slice(0, 8).map((product, i) => (
              <div key={product.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink truncate max-w-[60%]">{product.name}</span>
                  <div className="text-right">
                    <span className="text-xs font-mono text-accent">{fmt(product.revenue, 'currency')}</span>
                    <span className="text-xs font-mono text-muted ml-2">{product.units} units</span>
                  </div>
                </div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-green-500"
                    style={{ width: (product.revenue / maxRevenue * 100) + '%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer breakdown */}
      {(shopify.newCustomers != null || shopify.returningCustomers != null) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Customer Mix</h3>
              <AskClaudeCardButton
                cardTitle="Customer Mix"
                cardData={shopifyContext}
                clientId={clientId}
                clientName={clientName}
                platform={platform}
                dateRange={dateRange}
                openPanel={openPanel}
              />
            </div>
            <div className="space-y-3">
              {[
                { label: 'New customers', value: shopify.newCustomers || 0, color: '#2563eb' },
                { label: 'Returning customers', value: shopify.returningCustomers || 0, color: '#16a34a' },
              ].map(item => {
                const total = (shopify.newCustomers || 0) + (shopify.returningCustomers || 0)
                const pct = total > 0 ? (item.value / total) * 100 : 0
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-ink">{item.label}</span>
                      <span className="text-xs font-mono text-muted">{item.value} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct + '%', backgroundColor: item.color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Revenue summary card */}
          <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Revenue Summary</h3>
              <AskClaudeCardButton
                cardTitle="Revenue Summary"
                cardData={shopifyContext}
                clientId={clientId}
                clientName={clientName}
                platform={platform}
                dateRange={dateRange}
                openPanel={openPanel}
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-xs text-muted">Total revenue</span>
                <span className="text-xs font-mono text-ink">{shopify.totalRevenue != null ? fmt(shopify.totalRevenue, 'currency') : '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-xs text-muted">Total orders</span>
                <span className="text-xs font-mono text-ink">{shopify.totalOrders || '—'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-xs text-muted">Avg order value</span>
                <span className="text-xs font-mono text-ink">{shopify.avgOrderValue != null ? fmt(shopify.avgOrderValue, 'currency') : '—'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-xs text-muted">Revenue per customer</span>
                <span className="text-xs font-mono text-ink">
                  {shopify.totalRevenue && (shopify.newCustomers || 0) + (shopify.returningCustomers || 0) > 0
                    ? fmt(shopify.totalRevenue / ((shopify.newCustomers || 0) + (shopify.returningCustomers || 0)), 'currency')
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Shopify Tab Wrapper ──────────────────────────────────────────────────────
function ShopifyTabWrapper({ clientId, clientName, dateRange, platform, openPanel, customStart, customEnd }: {
  clientId: string; clientName: string; dateRange: string; platform: Platform
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
  customStart?: string; customEnd?: string
}) {
  const [shopifyData, setShopifyData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const params = new URLSearchParams({ clientId, dateRange })
    if (customStart) params.set('customStart', customStart)
    if (customEnd) params.set('customEnd', customEnd)
    fetch('/api/intelligence?' + params.toString())
      .then(r => r.json())
      .then(d => {
        if (d.intelligence?.shopify) {
          setShopifyData(d.intelligence.shopify)
        } else {
          setError('No Shopify data available')
        }
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [clientId, dateRange, customStart, customEnd])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-muted font-mono text-sm">
        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />Loading Shopify data...
      </div>
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center h-64 flex-col gap-2">
      <p className="text-muted font-mono text-sm">Could not load Shopify data</p>
      <p className="text-xs text-red-500">{error}</p>
    </div>
  )
  return <ShopifyTab shopify={shopifyData} clientId={clientId} clientName={clientName} dateRange={dateRange} platform={platform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />
}

// LORAMER_WOO_TAB_V1
// ─── WooCommerce Tab Wrapper ──────────────────────────────────────────────────
function WooCommerceTabWrapper({ clientId, clientName, dateRange, platform, openPanel, customStart, customEnd }: {
  clientId: string; clientName: string; dateRange: string; platform: Platform
  openPanel: (title: string, context: string, messages: { role: 'user' | 'assistant'; content: string }[]) => void
  customStart?: string; customEnd?: string
}) {
  const [wooData, setWooData] = useState<any>(null)
  useEffect(() => {
    if (!clientId) return
    const params = new URLSearchParams({ clientId, dateRange })
    if (customStart) params.set('customStart', customStart)
    if (customEnd) params.set('customEnd', customEnd)
    fetch('/api/intelligence?' + params.toString())
      .then(r => r.json())
      .then(d => { if (d.intelligence?.woocommerce) setWooData(d.intelligence.woocommerce) })
      .catch(() => {})
  }, [clientId, dateRange, customStart, customEnd])
  return (
    <ShopifyTab
      shopify={wooData}
      clientId={clientId}
      clientName={clientName}
      dateRange={dateRange}
      platform={platform}
      openPanel={openPanel}
      platformLabel="WooCommerce"
      apiPath="/api/woocommerce/daily"
      customStart={customStart}
      customEnd={customEnd}
    />
  )
}

// LORAMER_GA_CHART_V1
// ─── Google Analytics Chart ───────────────────────────────────────────────────
const GA_CHART_METRICS = [
  { id: 'sessions', label: 'Sessions', color: '#2563eb' },
  { id: 'totalUsers', label: 'Total Users', color: '#16a34a' },
  { id: 'newUsers', label: 'New Users', color: '#ea580c' },
  { id: 'keyEvents', label: 'Key Events', color: '#9333ea' },
  { id: 'engagedSessions', label: 'Engaged Sessions', color: '#0891b2' },
  { id: 'eventCount', label: 'Event Count', color: '#dc2626' },
  { id: 'screenPageViews', label: 'Pageviews', color: '#ca8a04' },
  { id: 'averageSessionDuration', label: 'Avg Session Duration', color: '#db2777' },
]

// LORAMER_CHART_CURRENCY_V1 — dataKeys whose tooltip values render as dollars.
// Declared after the last metric array so all five are defined above.
const CURRENCY_KEYS = new Set<string>([
  ...GOOGLE_METRICS.filter(m => (m as any).currency).map(m => m.id),
  ...META_METRICS.filter(m => (m as any).currency).map(m => m.id),
  ...SHOPIFY_METRICS.filter(m => (m as any).currency).map(m => m.id),
  ...GA_CHART_METRICS.filter(m => (m as any).currency).map(m => m.id),
  ...COMBINED_METRICS.filter(m => (m as any).currency).flatMap(m => [(m as any).googleKey, (m as any).metaKey]),
])

// LORAMER_GA_CHART_GRANULARITY_V1
function GaChart({ clientId, dateRange, customStart, customEnd }: {
  clientId: string
  dateRange: string
  customStart?: string
  customEnd?: string
}) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['sessions', 'totalUsers', 'newUsers'])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    let url = '/api/ga/daily?clientId=' + clientId + '&dateRange=' + dateRange + '&granularity=' + granularity
    if (customStart) url += '&customStart=' + customStart
    if (customEnd) url += '&customEnd=' + customEnd
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d.daily || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [clientId, dateRange, granularity, customStart, customEnd])

  const toggle = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])

  if (loading) return <div className="text-muted text-sm font-mono mb-6 h-8 flex items-center">Loading chart...</div>
  if (!data.length) {
    return (
      <div className="bg-white border border-border p-4 md:p-6 mb-6">
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-2">Performance Over Time</h3>
        <p className="text-sm font-mono text-muted">No daily Analytics data for this date range.</p>
      </div>
    )
  }

  const hasAnyValue = data.some((row: Record<string, number>) =>
    GA_CHART_METRICS.some(m => (row[m.id] ?? 0) > 0)
  )
  if (!hasAnyValue) {
    return (
      <div className="bg-white border border-border p-4 md:p-6 mb-6">
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-2">Performance Over Time</h3>
        <p className="text-sm font-mono text-muted">No daily Analytics data for this date range.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-border p-4 md:p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted">Performance Over Time</h3>
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
            {GA_CHART_METRICS.map(m => (
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
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {GA_CHART_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// LORAMER_GA_TAB_PROPERTY_NAME_V1
function isGaResourcePath(name: string): boolean {
  const t = name.trim()
  return /^properties\/\d+$/i.test(t) || /^\d{10,}$/.test(t)
}

function resolveGaDisplayName(ga: IntelligenceGa, connectionAccountName?: string): string {
  const candidates = [connectionAccountName, ga.propertyName].filter(Boolean) as string[]
  for (const c of candidates) {
    if (!isGaResourcePath(c)) return c
  }
  return candidates[0] || 'Google Analytics'
}

// LORAMER_GA_DASHBOARD_TAB_V1
// ─── Google Analytics Tab ─────────────────────────────────────────────────────
function GaTable({ title, headers, rows }: {
  title: string
  headers: { label: string; align?: 'left' | 'right' }[]
  rows: React.ReactNode[][]
}) {
  if (rows.length === 0) return null
  return (
    <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              {headers.map((h, i) => (
                <th key={i} className={'px-3 py-3 font-mono text-xs text-muted tracking-wider ' + (h.align === 'right' ? 'text-right' : 'text-left')}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} className="table-row">
                {cells.map((cell, j) => (
                  <td key={j} className={'px-3 py-3 ' + (headers[j]?.align === 'right' ? 'text-right font-mono text-sm' : 'text-sm')}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GoogleAnalyticsTab({ ga, clientId, dateRange, customStart, customEnd, connectionAccountName }: {
  ga: IntelligenceGa | null
  clientId: string
  dateRange: string
  customStart?: string
  customEnd?: string
  connectionAccountName?: string
}) {
  if (!ga || !ga.connected) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-4">
        <p className="text-2xl">📊</p>
        <p className="text-ink font-medium">Google Analytics data unavailable</p>
        <p className="text-muted font-mono text-sm">Could not fetch Analytics data. Check your Google Analytics connection.</p>
        <a href="/clients" className="btn-primary text-sm">Manage connections →</a>
      </div>
    )
  }

  const metrics = [
    { label: 'Sessions', value: ga.sessions != null ? fmt(ga.sessions) : '—' },
    { label: 'Total Users', value: ga.totalUsers != null ? fmt(ga.totalUsers) : '—' },
    { label: 'New Users', value: ga.newUsers != null ? fmt(ga.newUsers) : '—' },
    { label: 'Engagement Rate', value: formatEngagementRate(ga.engagementRate) },
    { label: 'Conversions', value: ga.conversions != null ? fmt(ga.conversions) : '—' },
    { label: 'Revenue', value: ga.totalRevenue != null ? fmt(ga.totalRevenue, 'currency') : '—' },
  ]

  const trafficSources = ga.topTrafficSources || []
  const topCampaigns = ga.topCampaigns || []
  const landingPages = ga.topLandingPages || []
  const conversionEvents = ga.conversionEvents || []
  const topCountries = ga.topCountries || []
  const devices = ga.deviceSplit || []
  const topProducts = ga.topProducts || []
  const transactionsBySource = ga.transactionsBySource || []
  const hasEcommerce = topProducts.length > 0 || transactionsBySource.length > 0 || ga.transactions != null
  const propertyDisplayName = resolveGaDisplayName(ga, connectionAccountName)

  return (
    <div className="space-y-4 md:space-y-6">
      <p
        className="text-xs font-mono text-muted"
        title={ga.propertyId && isGaResourcePath(ga.propertyId) ? ga.propertyId : undefined}
      >
        {propertyDisplayName}
      </p>

      {clientId && (
        <GaChart clientId={clientId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
      )}

      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border rounded-xl overflow-hidden">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="text-xs font-medium text-muted uppercase tracking-widest mb-1 md:mb-2">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>

      <GaTable
        title="Top Traffic Sources"
        headers={[
          { label: 'Source / Medium' },
          { label: 'Sessions', align: 'right' },
          { label: 'Conversions', align: 'right' },
          { label: 'Revenue', align: 'right' },
        ]}
        rows={trafficSources.map(s => [
          <span key="src" className="font-medium">{s.source} / {s.medium}</span>,
          fmt(s.sessions),
          fmt(s.conversions),
          fmt(s.totalRevenue, 'currency'),
        ])}
      />

      <GaTable
        title="Top Campaigns"
        headers={[
          { label: 'Campaign' },
          { label: 'Sessions', align: 'right' },
          { label: 'Conversions', align: 'right' },
          { label: 'Revenue', align: 'right' },
        ]}
        rows={topCampaigns.map(c => [
          <span key="camp" className="font-medium truncate max-w-xs inline-block">{c.campaignName}</span>,
          fmt(c.sessions),
          fmt(c.conversions),
          fmt(c.totalRevenue, 'currency'),
        ])}
      />

      <GaTable
        title="Top Landing Pages"
        headers={[
          { label: 'Landing Page' },
          { label: 'Sessions', align: 'right' },
          { label: 'Conv. Rate', align: 'right' },
        ]}
        rows={landingPages.map(p => [
          <span key="page" className="font-medium truncate max-w-md inline-block">{p.landingPage}</span>,
          fmt(p.sessions),
          formatEngagementRate(p.sessionConversionRate),
        ])}
      />

      <GaTable
        title="Conversion Events"
        headers={[
          { label: 'Event' },
          { label: 'Count', align: 'right' },
          { label: 'Value', align: 'right' },
        ]}
        rows={conversionEvents.map(e => [
          <span key="evt" className="font-medium">{e.eventName}</span>,
          fmt(e.eventCount),
          fmt(e.eventValue, 'currency'),
        ])}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GaTable
          title="Top Countries"
          headers={[
            { label: 'Country' },
            { label: 'Sessions', align: 'right' },
          ]}
          rows={topCountries.map(c => [
            c.country,
            fmt(c.sessions),
          ])}
        />

        <GaTable
          title="Devices"
          headers={[
            { label: 'Device' },
            { label: 'Sessions', align: 'right' },
          ]}
          rows={devices.map(d => [
            d.deviceCategory,
            fmt(d.sessions),
          ])}
        />
      </div>

      {hasEcommerce && (
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">E-commerce</h3>
          {ga.transactions != null && (
            <div className="bg-white border border-border p-4 md:p-5 rounded-xl shadow-sm">
              <div className="flex justify-between py-1">
                <span className="text-xs text-muted">Total transactions</span>
                <span className="text-xs font-mono text-ink">{fmt(ga.transactions)}</span>
              </div>
            </div>
          )}
          <GaTable
            title="Top Products"
            headers={[
              { label: 'Product' },
              { label: 'Purchased', align: 'right' },
              { label: 'Revenue', align: 'right' },
            ]}
            rows={topProducts.map(p => [
              <span key="prod" className="font-medium truncate max-w-xs inline-block">{p.itemName}</span>,
              fmt(p.itemsPurchased),
              fmt(p.itemRevenue, 'currency'),
            ])}
          />
          <GaTable
            title="Transactions by Source"
            headers={[
              { label: 'Source / Medium' },
              { label: 'Transactions', align: 'right' },
            ]}
            rows={transactionsBySource.map(t => [
              `${t.source} / ${t.medium}`,
              fmt(t.transactions),
            ])}
          />
        </div>
      )}
    </div>
  )
}

function GoogleAnalyticsTabWrapper({ clientId, dateRange, customStart, customEnd, connectionAccountName }: {
  clientId: string
  dateRange: string
  customStart?: string
  customEnd?: string
  connectionAccountName?: string
}) {
  const [gaData, setGaData] = useState<IntelligenceGa | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const params = new URLSearchParams({ clientId, dateRange })
    if (customStart) params.set('customStart', customStart)
    if (customEnd) params.set('customEnd', customEnd)
    fetch('/api/intelligence?' + params.toString())
      .then(r => r.json())
      .then(d => {
        if (d.intelligence?.ga) {
          setGaData(d.intelligence.ga)
        } else {
          setError('No Google Analytics data available')
        }
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [clientId, dateRange, customStart, customEnd])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-muted font-mono text-sm">
        <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />Loading Analytics data...
      </div>
    </div>
  )
  if (error && !gaData) return (
    <div className="flex items-center justify-center h-64 flex-col gap-2">
      <p className="text-muted font-mono text-sm">Could not load Google Analytics data</p>
      <p className="text-xs text-red-500">{error}</p>
    </div>
  )
  return (
    <GoogleAnalyticsTab
      ga={gaData}
      clientId={clientId}
      dateRange={dateRange}
      customStart={customStart}
      customEnd={customEnd}
      connectionAccountName={connectionAccountName}
    />
  )
}

// LORAMER_MEMORY_AUTODETECT_V1
function MemoryProposalToast() {
  const [proposal, setProposal] = useState<null | { clientId: string; suggestedContent: string; suggestedCategory: 'directive' | 'fact' | 'preference'; confidence: number; originalMessage: string }>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  useEffect(() => {
    function handle(e: Event) {
      const ce = e as CustomEvent
      const d = ce.detail
      if (!d?.proposal?.suggestedContent) return
      setProposal({
        clientId: d.clientId,
        originalMessage: d.originalMessage || '',
        ...d.proposal,
      })
      setSavedFlash(false)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('loramer-memory-proposal', handle as EventListener)
      return () => window.removeEventListener('loramer-memory-proposal', handle as EventListener)
    }
  }, [])
  async function saveAs(category: 'directive' | 'fact' | 'preference') {
    if (!proposal) return
    setSaving(true)
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: proposal.clientId,
          content: proposal.suggestedContent,
          category,
          source: 'user_conversation',
          confidence: proposal.confidence,
        }),
      })
      setSavedFlash(true)
      setTimeout(() => { setProposal(null); setSavedFlash(false) }, 1800)
    } catch {} finally { setSaving(false) }
  }
  if (!proposal) return null
  return (
    <div className="fixed bottom-6 right-6 z-[60] max-w-sm border border-accent/40 bg-white rounded-xl shadow-card-hover p-3">
      {savedFlash ? (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <span>✓</span>
          <span className="font-medium">Saved to memory</span>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted mb-1 font-mono uppercase tracking-wide">Save to memory?</p>
          <p className="text-sm text-ink mb-3 break-words">{proposal.suggestedContent}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => saveAs(proposal.suggestedCategory)}
              disabled={saving}
              className="text-xs font-mono bg-accent text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : `Save as ${proposal.suggestedCategory}`}
            </button>
            {proposal.suggestedCategory !== 'directive' && (
              <button onClick={() => saveAs('directive')} disabled={saving} className="text-xs font-mono border border-border text-muted hover:text-ink hover:border-ink px-2 py-1.5 rounded-lg">or directive</button>
            )}
            {proposal.suggestedCategory !== 'fact' && (
              <button onClick={() => saveAs('fact')} disabled={saving} className="text-xs font-mono border border-border text-muted hover:text-ink hover:border-ink px-2 py-1.5 rounded-lg">or fact</button>
            )}
            <button onClick={() => setProposal(null)} className="text-xs font-mono text-muted hover:text-ink ml-auto px-1">dismiss</button>
          </div>
        </>
      )}
    </div>
  )
}

function DashboardContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [activePlatform, setActivePlatform] = useState<Platform>(() => (ls('advar-active-platform') as Platform) || 'google')
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify' | 'woocommerce' | 'ga'>(() => {
    // LORAMER_DEFAULT_TAB_V1 - validate against known tabs, default to overview
    const saved = ls('advar-active-tab') as any
    const valid = ['overview', 'campaigns', 'keywords', 'chat', 'shopify', 'woocommerce', 'ga']  // LORAMER_GA_DASHBOARD_TAB_V1
    return valid.includes(saved) ? saved : 'overview'
  })
  const [dateRange, setDateRange] = useState<string>(() => ls('advar-date-range') || 'LAST_30_DAYS')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [platformData, setPlatformData] = useState<PlatformData | null>(null)
  const [shopifyData, setShopifyData] = useState<any>(null)
  const [gaData, setGaData] = useState<IntelligenceGa | null>(null)  // LORAMER_GA_OVERVIEW_COMBINED_V1
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)

  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>(() => lsJson('advar-chat-messages', []))
  const [chatLoading, setChatLoading] = useState(false)
  const [sessionStart, setSessionStart] = useState<number>(() => parseInt(ls('advar-session-start') || '0'))

  // Right panel state — shared across all AskClaude buttons
  const [panelOpen, setPanelOpen] = useState(() => ls('advar-panel-open') === 'true')
  const [panelMinimized, setPanelMinimized] = useState(() => ls('advar-panel-minimized') === 'true')
  const [panelMessages, setPanelMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>(() => lsJson('advar-panel-messages', []))
  const [panelContext, setPanelContext] = useState(() => ls('advar-panel-context') || '')
  const [panelTitle, setPanelTitle] = useState(() => ls('advar-panel-title') || '')
  const [panelInput, setPanelInput] = useState('')
  const [panelLoading, setPanelLoading] = useState(false)
  const [panelQuickPrompts, setPanelQuickPrompts] = useState<string[]>([])  // LORAMER_PANEL_ONLY_V1

  // LORAMER_CONV_API_V1_OPENPANEL
  // Loads prior conversation from /api/conversations for the panel's surface+scope.
  // Fixes the "panel empty after client switch" bug: conversation stays in DB but
  // in-memory state clears on client switch, so we re-fetch on each open.
  async function openPanel(title: string, context: string, existingMessages: { role: 'user' | 'assistant'; content: string }[] = [], quickPrompts: string[] = []) {  // LORAMER_PANEL_ONLY_V1
    setPanelTitle(title); lsSet('advar-panel-title', title)
    setPanelContext(context); lsSet('advar-panel-context', context)
    setPanelQuickPrompts(quickPrompts)
    setPanelOpen(true); lsSet('advar-panel-open', 'true')
    setPanelMinimized(false); lsSet('advar-panel-minimized', 'false')

    // Show whatever caller passed in immediately so the panel doesn't flash empty.
    setPanelMessages(existingMessages); lsSet('advar-panel-messages', JSON.stringify(existingMessages))

    // Then fetch prior history from the DB and overlay if we find any.
    if (!selectedClient?.id) return
    const scope = title.toLowerCase().replace(/\s+/g, '-') + ':' + activePlatform
    try {
      const params = new URLSearchParams({
        clientId: selectedClient.id,
        surface: 'right-panel',
        scope,
      })
      const r = await fetch('/api/conversations?' + params.toString())
      const d = await r.json()
      const prior = (d.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
      if (prior.length > 0) {
        setPanelMessages(prior)
        lsSet('advar-panel-messages', JSON.stringify(prior))
      }
    } catch {}
  }

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

  // LORAMER_CONV_API_V1_CHATTAB
  // On client switch, load that client's Ask Claude tab conversation from the API.
  // localStorage stays as transition backup; cleared after API load completes.
  useEffect(() => {
    if (!selectedClient?.id) return
    const params = new URLSearchParams({
      clientId: selectedClient.id,
      surface: 'ask-claude-tab',
    })
    fetch('/api/conversations?' + params.toString())
      .then(r => r.json())
      .then(d => {
        const msgs = (d.messages || []).map((m: any) => ({ role: m.role, content: m.content }))
        if (msgs.length > 0) {
          setChatMessages(msgs)
          setSessionStart(msgs.length)
        } else {
          // No messages in DB for this client - reset to empty (don't carry over
          // localStorage state from a different client)
          setChatMessages([])
          setSessionStart(0)
        }
      })
      .catch(() => {})
  }, [selectedClient?.id])

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
    const hasShopifyLocal = client.platform_connections.some(p => p.platform === 'shopify')
    const savedPlatform = overridePlatform || (ls('advar-active-platform') as Platform) || 'google'
    const resolved: Platform = (savedPlatform === 'google' && hasGoogle) ? 'google'
      : (savedPlatform === 'meta' && hasMeta) ? 'meta'
      : (savedPlatform === 'combined' && hasGoogle && hasMeta) ? 'combined'
      : hasGoogle ? 'google' : hasMeta ? 'meta' : 'google'
    setActivePlatform(resolved)
    // Restore saved tab (LORAMER_DEFAULT_TAB_V1 - validate)
    const savedTab = ls('advar-active-tab') as any
    const validTabs = ['overview', 'campaigns', 'keywords', 'chat', 'shopify', 'woocommerce', 'ga']  // LORAMER_GA_DASHBOARD_TAB_V1
    if (validTabs.includes(savedTab)) setActiveTab(savedTab)
    else setActiveTab('overview')
    // Only reset drill state and panel when switching to a different client
    const previousClientId = ls('advar-active-client-prev')
    if (previousClientId && previousClientId !== client.id) {
      lsSet('advar-drill-state', JSON.stringify({ level: 'campaigns', campaign: null, adGroup: null }))
      setPanelOpen(false); setPanelMinimized(false); setPanelMessages([])
      setPanelTitle(''); setPanelContext(''); setShopifyData(null); setGaData(null)  // LORAMER_GA_OVERVIEW_COMBINED_V1
      lsSet('advar-panel-open', 'false'); lsSet('advar-panel-minimized', 'false')
      lsSet('advar-panel-messages', '[]'); lsSet('advar-panel-title', ''); lsSet('advar-panel-context', '')
    }
    lsSet('advar-active-client-prev', client.id)
    // LORAMER_ECOM_TAB_DEFAULT_V1
    // Auto-default tab ONLY if the user hasn't explicitly chosen one for this session.
    // hasWooLocal duplicates the hasWoo derivation but we don't have it in scope here.
    const hasWooLocal = client.platform_connections.some(p => p.platform === 'woocommerce')
    const explicitTab = ls('advar-active-tab')
    const hasExplicitEcomChoice = explicitTab === 'shopify' || explicitTab === 'woocommerce'
    if (!hasGoogle && !hasMeta && !hasExplicitEcomChoice) {
      // Pick the ecommerce platform that exists
      if (hasShopifyLocal) {
        setActiveTab('shopify')
        lsSet('advar-active-tab', 'shopify')
      } else if (hasWooLocal) {
        setActiveTab('woocommerce')
        lsSet('advar-active-tab', 'woocommerce')
      }
    }
    // Load ad platform data if Google or Meta is connected
    if (hasGoogle || hasMeta) {
      loadData(client, resolved, dateRange, customStart, customEnd)
    } else {
      setPlatformData(null)
      setLoading(false)
    }
    // Always fetch Shopify data if Shopify is connected (regardless of ad platforms)
    if (hasShopifyLocal) {
      loadShopifyData(client.id, dateRange, customStart, customEnd)
    }
    // LORAMER_GA_OVERVIEW_COMBINED_V1 — fetch GA intelligence when connected
    const hasGaLocal = client.platform_connections.some(p => p.platform === 'ga')
    if (hasGaLocal) {
      loadGaData(client.id, dateRange, customStart, customEnd)
    }
  }

  async function loadShopifyData(clientId: string, dr: string, cs?: string, ce?: string) {
    try {
      const params = new URLSearchParams({ clientId, dateRange: dr })
      if (cs) params.set('customStart', cs)
      if (ce) params.set('customEnd', ce)
      const res = await fetch('/api/intelligence?' + params.toString())
      const d = await res.json()
      if (d.intelligence?.shopify) setShopifyData(d.intelligence.shopify)
    } catch (e) { console.error('Shopify data fetch error:', e) }
  }

  // LORAMER_GA_OVERVIEW_COMBINED_V1
  async function loadGaData(clientId: string, dr: string, cs?: string, ce?: string) {
    try {
      const params = new URLSearchParams({ clientId, dateRange: dr })
      if (cs) params.set('customStart', cs)
      if (ce) params.set('customEnd', ce)
      const res = await fetch('/api/intelligence?' + params.toString())
      const d = await res.json()
      if (d.intelligence?.ga) setGaData(d.intelligence.ga)
    } catch (e) { console.error('GA data fetch error:', e) }
  }

  function changePlatform(platform: Platform) {
    // LORAMER_PLATFORM_NAV_FIX_V1
    const adTabs: string[] = ['overview', 'campaigns', 'keywords']
    if (!adTabs.includes(activeTab as string)) {
      changeTab('overview')
    }
    setActivePlatform(platform)
    lsSet('advar-active-platform', platform)
    lsSet('advar-drill-state', JSON.stringify({ level: 'campaigns', campaign: null, adGroup: null }))
    if (selectedClient) loadData(selectedClient, platform, dateRange, customStart, customEnd)
  }

  function changeTab(tab: 'overview' | 'campaigns' | 'keywords' | 'chat' | 'shopify' | 'woocommerce' | 'ga') {
    setActiveTab(tab)
    lsSet('advar-active-tab', tab)
  }

  function changeDateRange(val: string) {
    setDateRange(val)
    lsSet('advar-date-range', val)
    if (val === 'CUSTOM') { setShowCustomPicker(true); return }
    setShowCustomPicker(false); setCustomStart(''); setCustomEnd('')
    if (selectedClient) {
      const hasGoogleOrMeta = selectedClient.platform_connections.some(p => p.platform === 'google' || p.platform === 'meta')
      const hasShopifyOnly = !hasGoogleOrMeta && selectedClient.platform_connections.some(p => p.platform === 'shopify')
      if (hasShopifyOnly) {
        // Shopify-only client — only refresh Shopify data, reset to shopify tab
        loadShopifyData(selectedClient.id, val, '', '')
      } else {
        loadData(selectedClient, activePlatform, val, '', '')
        if (selectedClient.platform_connections.some(p => p.platform === 'shopify')) {
          loadShopifyData(selectedClient.id, val, '', '')
        }
        if (selectedClient.platform_connections.some(p => p.platform === 'ga')) {
          loadGaData(selectedClient.id, val, '', '')
        }
      }
    }
  }

  function applyCustomRange() {
    if (customStart && customEnd && selectedClient) {
      const hasGoogleOrMeta = selectedClient.platform_connections.some(p => p.platform === 'google' || p.platform === 'meta')
      if (hasGoogleOrMeta) loadData(selectedClient, activePlatform, 'CUSTOM', customStart, customEnd)
      if (selectedClient.platform_connections.some(p => p.platform === 'shopify')) {
        loadShopifyData(selectedClient.id, 'CUSTOM', customStart, customEnd)
      }
      if (selectedClient.platform_connections.some(p => p.platform === 'ga')) {
        loadGaData(selectedClient.id, 'CUSTOM', customStart, customEnd)
      }
    }
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
    const metaConn = selectedClient.platform_connections.find(p => p.platform === 'meta')

    // Read current drill state from localStorage
    const drillState = lsJson('advar-drill-state', { level: 'campaigns', campaign: null, adGroup: null }) as any

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: history.slice(0, -1),
          // Platform context
          platform: activePlatform,
          platformData,
          dateRange,
          customStart,
          customEnd,
          // LORAMER_CUSTOM_DATE_RANGE_FIX_V2
          // Client context
          clientId: selectedClient.id,
          clientName: selectedClient.name,
          accountId: googleConn?.account_id,
          // Drill context
          drillLevel: drillState.level,
          drillCampaign: drillState.campaign,
          drillAdGroup: drillState.adGroup,
          // LORAMER_FOCUS_LOCATION_V1 - tell the chat route which tab we're on
          location: activeTab,
        }),
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
      // LORAMER_CONV_API_V1_CHATTAB + LORAMER_MEMORY_AUTODETECT_V1
      try {
        const userR = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: selectedClient.id,
            surface: 'ask-claude-tab',
            scope: null,
            role: 'user',
            content: userMsg,
          }),
        })
        const userD = await userR.json().catch(() => ({}))
        if (userD?.proposeMemory && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('loramer-memory-proposal', {
            detail: { clientId: selectedClient.id, proposal: userD.proposeMemory, originalMessage: userMsg },
          }))
        }
        await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: selectedClient.id,
            surface: 'ask-claude-tab',
            scope: null,
            role: 'assistant',
            content: data.response,
          }),
        })
      } catch {}
    } catch { setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]) }
    finally { setChatLoading(false) }
  }

  function downloadChat() {
    const text = chatMessages.map(m => (m.role === 'user' ? 'You' : 'Lora') + ': ' + m.content).join('\n\n---\n\n')
    const header = 'LoraMer Chat Export\nClient: ' + (selectedClient?.name || '') + '\nDate: ' + new Date().toLocaleDateString() + '\n\n'
    const blob = new Blob([header + text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = 'loramer-' + (selectedClient?.name || 'chat').replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + new Date().toISOString().split('T')[0] + '.txt'
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
        else if (t.startsWith('Lora: ')) messages.push({ role: 'assistant', content: t.slice(6) })
        else if (t.startsWith('Claude: ')) messages.push({ role: 'assistant', content: t.slice(8) })  // legacy transcripts exported before the Lora rename
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
  const hasShopify = !!selectedClient?.platform_connections.find(p => p.platform === 'shopify')
  const hasWoo = !!selectedClient?.platform_connections.find(p => p.platform === 'woocommerce')  // LORAMER_WOO_TAB_V1
  const hasGa = !!selectedClient?.platform_connections.find(p => p.platform === 'ga')  // LORAMER_GA_DASHBOARD_TAB_V1
  const hasBoth = hasGoogle && hasMeta
  const googleAccountId = googleConn?.account_id || ''
  const metaAccountId = metaConn?.account_id || ''
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.googleOnly && !hasGoogle) return false  // LORAMER_KEYWORDS_NAV_GATE_V1
    if (item.shopifyOnly && !hasShopify) return false
    if (item.wooOnly && !hasWoo) return false  // LORAMER_WOO_TAB_V1
    if (item.gaOnly && !hasGa) return false  // LORAMER_GA_DASHBOARD_TAB_V1
    if (item.hideForShopifyOnly && !hasGoogle && !hasMeta && (hasShopify || hasWoo)) return false  // LORAMER_WOO_TAB_V1
    return true
  })
  const dateLabel = dateRange === 'CUSTOM' && customStart && customEnd ? customStart + ' – ' + customEnd : DATE_RANGES.find(d => d.value === dateRange)?.label || ''

  return (
    <div className="min-h-screen bg-paper flex">
      {/* LORAMER_MEMORY_AUTODETECT_V1 */}
      <MemoryProposalToast />
      {/* Desktop Sidebar */}
      <div className={`hidden md:flex flex-col border-r border-border bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`} style={{ minHeight: '100vh', position: 'sticky', top: 0, maxHeight: '100vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          {!sidebarCollapsed && <span className="font-display text-lg text-ink">LoraMer</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-muted hover:text-ink transition-colors ml-auto">
            {sidebarCollapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
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
            {!sidebarCollapsed && <p className="px-4 pt-2 pb-1 text-xs text-muted">Platform</p>}
            {hasGoogle && (
              <button onClick={() => changePlatform('google')} title={sidebarCollapsed ? 'Google Ads' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'google' ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <IconBrandGoogle size={16} className="flex-shrink-0" />
                {!sidebarCollapsed && <span className="text-sm">Google Ads</span>}
              </button>
            )}
            {hasMeta && (
              <button onClick={() => changePlatform('meta')} title={sidebarCollapsed ? 'Meta Ads' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'meta' ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <IconBrandMeta size={16} className="flex-shrink-0" />
                {!sidebarCollapsed && <span className="text-sm">Meta Ads</span>}
              </button>
            )}
            {hasBoth && (
              <button onClick={() => changePlatform('combined')} title={sidebarCollapsed ? 'Combined' : undefined}
                className={'w-full flex items-center gap-3 px-4 py-2 pb-2 transition-colors ' + (activePlatform === 'combined' ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
                <IconLayersIntersect size={16} className="flex-shrink-0" />
                {!sidebarCollapsed && <span className="text-sm">Combined</span>}
              </button>
            )}
          </div>
        )}
        <nav className="py-2 flex-shrink-0">
          {visibleNavItems.map(item => (
            <button key={item.id} onClick={() => changeTab(item.id as any)} title={sidebarCollapsed ? item.label : undefined}
              className={'w-full flex items-center gap-3 px-4 py-2.5 transition-colors ' + (activeTab === item.id ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:text-ink hover:bg-surface')}>
              <NavIcon id={item.id} />
              {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-border flex-shrink-0">
          {!sidebarCollapsed && (
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-xs text-muted">Clients</span>
              <a href="/clients" className="text-xs text-accent hover:underline">+ Edit</a>
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
            <IconRefresh size={18} />
            {!sidebarCollapsed && <span className="text-sm">Refresh</span>}
          </button>
          <button onClick={() => signOut({ callbackUrl: '/' })} title="Sign out"
            className="w-full flex items-center gap-3 px-4 py-2.5 text-muted hover:text-ink hover:bg-surface transition-colors">
            <IconLogout size={18} />
            {!sidebarCollapsed && <span className="text-sm">Sign out</span>}
          </button>
          {!sidebarCollapsed && (
            <div className="px-4 py-3 flex gap-3">
              <a href="/privacy" target="_blank" className="text-xs text-muted hover:text-ink transition-colors">Privacy</a>
              <span className="text-xs text-muted">·</span>
              <a href="/terms" target="_blank" className="text-xs text-muted hover:text-ink transition-colors">Terms</a>
            </div>
          )}
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
          <span className="font-display text-base text-ink">LoraMer</span>
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
          {/* Overview — works with ad data, shopify data, or both */}
          {!loading && activeTab === 'overview' && (platformData || shopifyData) && (
            <OverviewTab data={platformData} googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} customStart={customStart} customEnd={customEnd} openPanel={openPanel} shopify={shopifyData} ga={gaData} hasGa={hasGa} />
          )}
          {!loading && platformData && activeTab === 'campaigns' && (
            <CampaignsTab data={platformData} googleAccountId={googleAccountId} metaAccountId={metaAccountId} dateRange={dateRange} clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} customStart={customStart} customEnd={customEnd} openPanel={openPanel} />
          )}
          {!loading && activeTab === 'keywords' && activePlatform === 'google' && googleAccountId && (
            <KeywordsTab accountId={googleAccountId} dateRange={dateRange} clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} platformData={platformData} customStart={customStart} customEnd={customEnd} />
          )}
          {activeTab === 'shopify' && hasShopify && (
            <ShopifyTabWrapper clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} dateRange={dateRange} platform={activePlatform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />
          )}
          {/* LORAMER_WOO_TAB_V1 */}
          {activeTab === 'woocommerce' && hasWoo && (
            <WooCommerceTabWrapper clientId={selectedClient?.id || ''} clientName={selectedClient?.name || ''} dateRange={dateRange} platform={activePlatform} openPanel={openPanel} customStart={customStart} customEnd={customEnd} />
          )}
          {/* LORAMER_GA_DASHBOARD_TAB_V1 */}
          {activeTab === 'ga' && hasGa && (
            <GoogleAnalyticsTabWrapper
              clientId={selectedClient?.id || ''}
              dateRange={dateRange}
              customStart={customStart}
              customEnd={customEnd}
              connectionAccountName={selectedClient?.platform_connections.find(p => p.platform === 'ga')?.account_name}
            />
          )}
          {activeTab === 'chat' && (
            <ChatTab messages={chatMessages} input={chatInput} loading={chatLoading} onInputChange={setChatInput}
              onSend={sendChat} accountSelected={!!selectedClient} onDownload={downloadChat} onUpload={uploadChat}
              exchangeCount={exchangeCount} platform={activePlatform} clientName={selectedClient?.name || ''}
              drillLevel={lsJson('advar-drill-state', { level: 'campaigns' } as any).level} />
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
                <NavIcon id={item.id} size={20} />
                <span className="text-[11px]">{item.label}</span>
              </button>
            ))}
            <button onClick={() => setMobileMoreOpen(!mobileMoreOpen)}
              className={'flex-1 flex flex-col items-center py-2 px-1 transition-colors ' + (mobileMoreOpen ? 'text-accent' : 'text-muted hover:text-ink')}>
              <span className="text-lg leading-none mb-0.5">•••</span>
              <span className="text-[11px]">More</span>
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

      {/* Global Right Panel */}
      {panelOpen && (
        <>
          {panelMinimized ? (
            // Minimized tab — sits at bottom right
            <button
              onClick={() => { setPanelMinimized(false); lsSet('advar-panel-minimized', 'false') }}
              className="fixed bottom-20 right-0 z-50 bg-accent text-white text-xs font-mono px-3 py-2 rounded-l-lg shadow-lg flex items-center gap-2 hover:bg-blue-700 transition-colors">
              ✦ {panelTitle.slice(0, 20)}{panelTitle.length > 20 ? '…' : ''}
              {panelMessages.length > 0 && <span className="bg-white text-accent rounded-full w-4 h-4 flex items-center justify-center text-xs font-bold">{Math.floor(panelMessages.length / 2)}</span>}
            </button>
          ) : (
            <RightPanel
              open={panelOpen}
              onClose={() => { setPanelOpen(false); setPanelMinimized(false); lsSet('advar-panel-open', 'false'); lsSet('advar-panel-minimized', 'false') }}
              onMinimize={() => { setPanelMinimized(true); lsSet('advar-panel-minimized', 'true') }}
              title={panelTitle}
              context={panelContext}
              messages={panelMessages}
              setMessages={(msgs) => { setPanelMessages(msgs); lsSet('advar-panel-messages', JSON.stringify(msgs)) }}
              input={panelInput}
              setInput={setPanelInput}
              loading={panelLoading}
              setLoading={setPanelLoading}
              clientId={selectedClient?.id || ''}
              clientName={selectedClient?.name || ''}
              platform={activePlatform}
              dateRange={dateRange}
              customStart={customStart}
              customEnd={customEnd}
              quickPrompts={panelQuickPrompts}
            />
          )}
        </>
      )}
    </div>
  )
}

import { DashboardErrorBoundary } from "@/components/DashboardErrorBoundary"

export default function Dashboard() {
  return (
    <DashboardErrorBoundary><Suspense fallback={<LoadingScreen />}>
      <DashboardContent />
      <DiamondCoachmark />
    </Suspense></DashboardErrorBoundary>
  )
}
