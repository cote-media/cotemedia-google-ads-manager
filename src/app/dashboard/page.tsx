'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
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

const CHART_METRICS = [
  { id: 'cost', label: 'Spend', color: '#2563eb' },
  { id: 'clicks', label: 'Clicks', color: '#16a34a' },
  { id: 'impressions', label: 'Impressions', color: '#9333ea' },
  { id: 'conversions', label: 'Conversions', color: '#ea580c' },
]

type Client = {
  id: string
  name: string
  platform_connections: { id: string; platform: string; account_id: string; account_name: string }[]
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmt(n: number, type: 'currency' | 'number' | 'percent' | 'decimal' = 'number'): string {
  if (type === 'currency') return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (type === 'percent') return n.toFixed(2) + '%'
  if (type === 'decimal') return n.toFixed(2)
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
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">
        ⊞ Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-52">
          <p className="font-mono text-xs text-muted uppercase tracking-wider mb-3">Show columns</p>
          {available.map(col => (
            <label key={col.id} className="flex items-center gap-2 py-1 cursor-pointer">
              <input type="checkbox" checked={active.includes(col.id)}
                onChange={e => { if (e.target.checked) onChange([...active, col.id]); else onChange(active.filter(c => c !== col.id)) }}
                className="accent-accent" />
              <span className="text-xs text-ink">{col.label}</span>
            </label>
          ))}
          <button onClick={() => setOpen(false)} className="mt-3 text-xs text-muted hover:text-ink font-mono">Done</button>
        </div>
      )}
    </div>
  )
}

// ─── Performance Chart ────────────────────────────────────────────────────────
function PerformanceChart({ accountId, dateRange, platform, campaignId, campaignName, customStart, customEnd }: {
  accountId: string; dateRange: string; platform: string; campaignId?: string; campaignName?: string; customStart?: string; customEnd?: string
}) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeMetrics, setActiveMetrics] = useState<string[]>(['cost', 'clicks'])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')

  useEffect(() => {
    if (platform !== 'google') { setLoading(false); return }
    setLoading(true)
    let url = '/api/daily?accountId=' + accountId + '&dateRange=' + dateRange + '&granularity=' + granularity
    if (campaignId) url += '&campaignId=' + campaignId
    if (customStart) url += '&customStart=' + customStart
    if (customEnd) url += '&customEnd=' + customEnd
    fetch(url)
      .then(r => r.json())
      .then(d => { setData((d.daily || []).map((row: any) => ({ ...row, date: String(row.date).slice(5) }))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, dateRange, campaignId, granularity, customStart, customEnd, platform])

  const toggleMetric = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])

  if (platform !== 'google') return null
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
            {CHART_METRICS.map(m => (
              <button key={m.id} onClick={() => toggleMetric(m.id)}
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
          {CHART_METRICS.filter(m => activeMetrics.includes(m.id)).map(m => (
            <Line key={m.id} type="monotone" dataKey={m.id} stroke={m.color} strokeWidth={2} dot={false} name={m.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Campaigns Table ──────────────────────────────────────────────────────────
function CampaignsTable({ campaigns, platform, activeCols, selectedCampaignId, onSelectCampaign }: {
  campaigns: Campaign[]
  platform: Platform
  activeCols: string[]
  selectedCampaignId?: string
  onSelectCampaign?: (id: string, name: string) => void
}) {
  const [sortCol, setSortCol] = useState('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  const visibleCols = COLUMN_DEFS.filter(c => c.platforms.includes(platform) && activeCols.includes(c.id))

  const sorted = [...campaigns].sort((a, b) => {
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

  function formatValue(col: typeof COLUMN_DEFS[0], c: Campaign): string {
    const val = col.getValue(c)
    if (val === null || val === undefined) return '—'
    const n = Number(val)
    if (['spend', 'costPerConv', 'avgCpc', 'cpm', 'budget'].includes(col.id)) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (['ctr', 'convRate'].includes(col.id)) return n.toFixed(2) + '%'
    if (['roas'].includes(col.id)) return n.toFixed(2) + 'x'
    if (['frequency'].includes(col.id)) return n.toFixed(2)
    if (['clicks', 'impressions', 'reach'].includes(col.id)) return n.toLocaleString()
    if (['conversions'].includes(col.id)) return n.toFixed(1)
    return String(val)
  }

  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface">Campaign</th>
            {platform === 'combined' && <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Platform</th>}
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Status</th>
            {visibleCols.map(col => (
              <th key={col.id} onClick={() => handleSort(col.id)}
                className="text-right px-3 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none whitespace-nowrap">
                {col.label}{sortCol === col.id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c: Campaign) => {
            const isSelected = selectedCampaignId === c.id
            return (
              <tr key={c.id + c.platform}
                onClick={() => onSelectCampaign && onSelectCampaign(isSelected ? '' : c.id, c.name)}
                className={'table-row ' + (onSelectCampaign ? 'cursor-pointer ' : '') + (isSelected ? 'bg-blue-50' : '')}>
                <td className={'px-3 py-3 font-medium max-w-xs truncate sticky left-0 ' + (isSelected ? 'bg-blue-50' : 'bg-white')}>
                  {isSelected && <span className="text-accent mr-1">▸</span>}{c.name}
                </td>
                {platform === 'combined' && (
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="text-xs font-mono text-muted">{c.platform === 'google' ? '🔵' : '🔷'} {c.platform === 'google' ? 'Google' : 'Meta'}</span>
                  </td>
                )}
                <td className="px-3 py-3 whitespace-nowrap"><StatusBadge status={c.status} /></td>
                {visibleCols.map(col => (
                  <td key={col.id} className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">
                    {formatValue(col, c)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ data, googleAccountId, dateRange, customStart, customEnd }: {
  data: PlatformData; googleAccountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const { totals, campaigns, platform } = data
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const metrics = [
    { label: 'Total Spend', value: fmt(totals.spend, 'currency') },
    { label: 'Clicks', value: fmt(totals.clicks) },
    { label: 'Impressions', value: fmt(totals.impressions) },
    { label: 'Conversions', value: fmt(totals.conversions, 'decimal') },
    { label: 'ROAS', value: totals.roas ? totals.roas.toFixed(2) + 'x' : '—' },
    { label: 'Avg CTR', value: fmt(totals.avgCtr, 'percent') },
  ]

  const anomalies: string[] = []
  if (totals.roas !== null && totals.roas < 0.5 && totals.spend > 100) anomalies.push('ROAS is critically low at ' + totals.roas.toFixed(2) + 'x')
  const pausedWithSpend = campaigns.filter(c => c.status === 'paused' && c.spend > 0)
  if (pausedWithSpend.length > 0) anomalies.push(pausedWithSpend.length + ' paused campaign(s) recorded spend')
  const zeroConvHighSpend = campaigns.filter(c => c.conversions === 0 && c.spend > 50)
  if (zeroConvHighSpend.length > 0) anomalies.push(zeroConvHighSpend.length + ' campaign(s) spent $50+ with zero conversions')
  const hasAnomalies = anomalies.length > 0

  const topByCost = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5)
  const topByConv = [...campaigns].filter(c => c.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 5)
  const maxCost = topByCost.length > 0 ? topByCost[0].spend : 1
  const campaignsWithBudget = campaigns.filter(c => c.budget && c.budget > 0).slice(0, 5)

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Insight banner */}
      <div className={`border px-4 md:px-6 py-4 md:py-5 ${hasAnomalies ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-200'}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className={`font-mono text-xs uppercase tracking-widest mb-2 ${hasAnomalies ? 'text-amber-600' : 'text-accent'}`}>
              {hasAnomalies ? '⚠ Attention needed' : '✦ Account snapshot'}
            </p>
            {hasAnomalies ? (
              <div className="space-y-1">{anomalies.map((a, i) => <p key={i} className="text-sm text-amber-800 font-medium">• {a}</p>)}</div>
            ) : (
              <p className="text-sm text-ink">
                {greeting}. <strong>{fmt(totals.spend, 'currency')}</strong> spent,{' '}
                <strong>{fmt(totals.conversions, 'decimal')}</strong> conversions.{' '}
                {totals.activeCampaigns} active campaigns.
              </p>
            )}
          </div>
          <span className="text-xs font-mono text-muted ml-4 mt-0.5 whitespace-nowrap hidden md:block">AI analysis coming soon</span>
        </div>
      </div>

      {/* Combined platform breakdown */}
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

      {/* Metric tiles */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="metric-label mb-1 md:mb-2 text-xs">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Cards */}
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
          {topByConv.length === 0 ? (
            <p className="text-xs text-muted font-mono">No conversions recorded</p>
          ) : (
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

        {platform === 'google' && (
          <div className="bg-white border border-border p-4 md:p-5">
            <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Top Keywords by Spend</h3>
            <TopKeywordsCard accountId={googleAccountId} dateRange={dateRange} />
          </div>
        )}

        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Budget Utilization</h3>
          {campaignsWithBudget.length === 0 ? (
            <p className="text-xs text-muted font-mono">No budget data available</p>
          ) : (
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

      {platform === 'google' && googleAccountId && (
        <PerformanceChart accountId={googleAccountId} dateRange={dateRange} platform={platform} customStart={customStart} customEnd={customEnd} />
      )}
    </div>
  )
}

function TopKeywordsCard({ accountId, dateRange }: { accountId: string; dateRange: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json())
      .then(d => { setKeywords((d.keywords || []).slice(0, 5)); setLoading(false) })
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

// ─── Campaigns Tab ────────────────────────────────────────────────────────────
function CampaignsTab({ data, googleAccountId, dateRange, customStart, customEnd }: {
  data: PlatformData; googleAccountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const { campaigns, platform } = data
  const storageKey = 'advar-cols-' + platform
  const defaultCols = COLUMN_DEFS.filter(c => c.platforms.includes(platform) && c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem(storageKey) || 'null') || defaultCols } catch { return defaultCols }
    }
    return defaultCols
  })
  const [selectedId, setSelectedId] = useState('')
  const [selectedName, setSelectedName] = useState('')

  const updateCols = (cols: string[]) => {
    setActiveCols(cols)
    if (typeof window !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(cols))
  }

  const handleSelect = (id: string, name: string) => { setSelectedId(id); setSelectedName(id ? name : '') }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Campaigns</h2>
          <p className="text-sm text-muted font-mono">
            {campaigns.length} campaigns
            {selectedName && <span className="text-accent"> · {selectedName}</span>}
          </p>
        </div>
        <ColumnPicker platform={platform} active={activeCols} onChange={updateCols} />
      </div>
      {platform === 'google' && googleAccountId && (
        <PerformanceChart accountId={googleAccountId} dateRange={dateRange} platform={platform}
          campaignId={selectedId || undefined} campaignName={selectedName || undefined}
          customStart={customStart} customEnd={customEnd} />
      )}
      <CampaignsTable campaigns={campaigns} platform={platform} activeCols={activeCols}
        selectedCampaignId={selectedId} onSelectCampaign={handleSelect} />
    </div>
  )
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────
function KeywordsTab({ accountId, dateRange }: { accountId: string; dateRange: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
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
  const [activeCols, setActiveCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('advar-kw-cols') || 'null') || kwCols.filter(c => c.defaultOn).map(c => c.id) } catch { return kwCols.filter(c => c.defaultOn).map(c => c.id) }
    }
    return kwCols.filter(c => c.defaultOn).map(c => c.id)
  })
  const has = (id: string) => activeCols.includes(id)
  const updateCols = (cols: string[]) => { setActiveCols(cols); if (typeof window !== 'undefined') localStorage.setItem('advar-kw-cols', JSON.stringify(cols)) }

  useEffect(() => {
    setLoading(true)
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json())
      .then(d => { setKeywords(d.keywords || []); setLoading(false) })
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Keywords</h2>
          <p className="text-sm text-muted font-mono">Top 200 by spend</p>
        </div>
        <div className="relative">
          <button onClick={() => {
            const open = document.getElementById('kw-col-picker')
            if (open) open.classList.toggle('hidden')
          }} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">
            ⊞ Columns
          </button>
          <div id="kw-col-picker" className="hidden absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-48">
            <p className="font-mono text-xs text-muted uppercase tracking-wider mb-3">Show columns</p>
            {kwCols.map(col => (
              <label key={col.id} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox" checked={activeCols.includes(col.id)}
                  onChange={e => { if (e.target.checked) updateCols([...activeCols, col.id]); else updateCols(activeCols.filter(c => c !== col.id)) }}
                  className="accent-accent" />
                <span className="text-xs text-ink">{col.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="text-muted text-sm font-mono">Loading keywords...</div>
      ) : (
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
                  {has('qs') && (
                    <td className="px-3 py-3 text-right font-mono text-sm font-medium">
                      {k.qualityScore ? <span title="Quality Score" className={'cursor-help ' + qsColor(k.qualityScore)}>{k.qualityScore}</span> : <span className="text-muted">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
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
          <p className="text-sm text-muted font-mono">Asking about {clientName} · {platformLabel}</p>
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
  const [activePlatform, setActivePlatform] = useState<Platform>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('advar-active-platform') as Platform) || 'google'
    return 'google'
  })
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('advar-active-tab') as any) || 'overview'
    return 'overview'
  })
  const [dateRange, setDateRange] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('advar-date-range') || 'LAST_30_DAYS'
    return 'LAST_30_DAYS'
  })
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [platformData, setPlatformData] = useState<PlatformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)

  // Chat state
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('advar-chat-messages') || '[]') } catch { return [] }
    }
    return []
  })
  const [chatLoading, setChatLoading] = useState(false)
  const [sessionStart, setSessionStart] = useState(() => {
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('advar-session-start')
      return s ? parseInt(s) : 0
    }
    return 0
  })

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])
  useEffect(() => { if (session) fetchClients() }, [session])
  useEffect(() => { if (chatMessages.length > 0) localStorage.setItem('advar-chat-messages', JSON.stringify(chatMessages)) }, [chatMessages])
  useEffect(() => { localStorage.setItem('advar-session-start', String(sessionStart)) }, [sessionStart])

  async function fetchClients() {
    try {
      const res = await fetch('/api/clients')
      const data = await res.json()
      const list: Client[] = data.clients || []
      setClients(list)
      const savedId = localStorage.getItem('advar-active-client')
      const saved = list.find(c => c.id === savedId)
      const toSelect = saved || list[0] || null
      if (toSelect) selectClient(toSelect, activePlatform)
    } catch (e) { console.error(e) }
  }

  function selectClient(client: Client, platform?: Platform) {
    setSelectedClient(client)
    localStorage.setItem('advar-active-client', client.id)
    const hasGoogle = client.platform_connections.some(p => p.platform === 'google')
    const hasMeta = client.platform_connections.some(p => p.platform === 'meta')
    const savedPlatform = platform || (localStorage.getItem('advar-active-platform') as Platform) || 'google'
    const resolvedPlatform = (savedPlatform === 'google' && hasGoogle) ? 'google'
      : (savedPlatform === 'meta' && hasMeta) ? 'meta'
      : (savedPlatform === 'combined' && hasGoogle && hasMeta) ? 'combined'
      : hasGoogle ? 'google' : hasMeta ? 'meta' : 'google'
    setActivePlatform(resolvedPlatform)
    loadData(client, resolvedPlatform, dateRange, customStart, customEnd)
  }

  function changePlatform(platform: Platform) {
    setActivePlatform(platform)
    localStorage.setItem('advar-active-platform', platform)
    if (selectedClient) loadData(selectedClient, platform, dateRange, customStart, customEnd)
  }

  function changeTab(tab: 'overview' | 'campaigns' | 'keywords' | 'chat') {
    setActiveTab(tab)
    localStorage.setItem('advar-active-tab', tab)
  }

  function changeDateRange(val: string) {
    setDateRange(val)
    localStorage.setItem('advar-date-range', val)
    if (val === 'CUSTOM') { setShowCustomPicker(true); return }
    setShowCustomPicker(false); setCustomStart(''); setCustomEnd('')
    if (selectedClient) loadData(selectedClient, activePlatform, val, '', '')
  }

  function applyCustomRange() {
    if (customStart && customEnd && selectedClient) {
      loadData(selectedClient, activePlatform, 'CUSTOM', customStart, customEnd)
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
      const data = await res.json()
      setPlatformData(data)
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
        body: JSON.stringify({
          message: userMsg,
          accountId: googleConn?.account_id,
          summary: platformData,
          dateRange, history: history.slice(0, -1),
          accountName: selectedClient.name,
          platform: activePlatform,
        }),
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
    const a = document.createElement('a')
    a.href = url
    a.download = 'advar-' + (selectedClient?.name || 'chat').replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + new Date().toISOString().split('T')[0] + '.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  function uploadChat(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target ? (ev.target.result as string) : null
      if (!text) return
      const lines = (text as string).split('\n\n---\n\n')
      const messages: { role: string; content: string }[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('You: ')) messages.push({ role: 'user', content: trimmed.slice(5) })
        else if (trimmed.startsWith('Claude: ')) messages.push({ role: 'assistant', content: trimmed.slice(8) })
      }
      if (messages.length > 0) {
        const restored = [...messages, { role: 'assistant', content: "I've read through our previous conversation and have full context. What would you like to tackle next?" }]
        setChatMessages(restored)
        setSessionStart(restored.length)
        setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  if (status === 'loading') return <LoadingScreen />

  const exchangeCount = Math.floor((chatMessages.length - sessionStart) / 2)
  const googleConn = selectedClient?.platform_connections.find(p => p.platform === 'google')
  const metaConn = selectedClient?.platform_connections.find(p => p.platform === 'meta')
  const hasGoogle = !!googleConn
  const hasMeta = !!metaConn
  const hasBoth = hasGoogle && hasMeta
  const googleAccountId = googleConn?.account_id || ''

  // Platform-aware nav — hide keywords on meta/combined
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.googleOnly && activePlatform !== 'google') return false
    return true
  })

  const dateLabel = dateRange === 'CUSTOM' && customStart && customEnd
    ? customStart + ' – ' + customEnd
    : DATE_RANGES.find(d => d.value === dateRange)?.label || ''

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Desktop Sidebar */}
      <div className={`hidden md:flex flex-col border-r border-border bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`} style={{ minHeight: '100vh', position: 'sticky', top: 0, maxHeight: '100vh', overflowY: 'auto' }}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          {!sidebarCollapsed && <span className="font-display text-lg text-ink">Advar</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-muted hover:text-ink transition-colors ml-auto">
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        {/* Date range */}
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

        {/* Platform selector */}
        {selectedClient && (hasGoogle || hasMeta) && (
          <div className="border-b border-border flex-shrink-0">
            {!sidebarCollapsed && <p className="px-4 pt-2 pb-1 font-mono text-xs text-muted uppercase tracking-wider">Platform</p>}
            {hasGoogle && (
              <button onClick={() => changePlatform('google')}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'google' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}
                title={sidebarCollapsed ? 'Google Ads' : undefined}>
                <span className="text-sm">🔵</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Google Ads</span>}
              </button>
            )}
            {hasMeta && (
              <button onClick={() => changePlatform('meta')}
                className={'w-full flex items-center gap-3 px-4 py-2 transition-colors ' + (activePlatform === 'meta' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}
                title={sidebarCollapsed ? 'Meta Ads' : undefined}>
                <span className="text-sm">🔷</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Meta Ads</span>}
              </button>
            )}
            {hasBoth && (
              <button onClick={() => changePlatform('combined')}
                className={'w-full flex items-center gap-3 px-4 py-2 pb-2 transition-colors ' + (activePlatform === 'combined' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-muted hover:text-ink hover:bg-surface')}
                title={sidebarCollapsed ? 'Combined' : undefined}>
                <span className="text-sm">⊕</span>
                {!sidebarCollapsed && <span className="text-xs font-mono">Combined</span>}
              </button>
            )}
          </div>
        )}

        {/* Nav items */}
        <nav className="py-2 flex-shrink-0">
          {visibleNavItems.map(item => (
            <button key={item.id} onClick={() => changeTab(item.id as any)} title={sidebarCollapsed ? item.label : undefined}
              className={'w-full flex items-center gap-3 px-4 py-2.5 transition-colors ' + (activeTab === item.id ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-surface')}>
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Client list */}
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
                <span className="w-4 h-4 rounded-full bg-accent flex-shrink-0 flex items-center justify-center text-white text-xs">
                  {client.name.charAt(0).toUpperCase()}
                </span>
                {!sidebarCollapsed && <span className="text-xs truncate">{client.name}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom actions */}
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar */}
        <div className="hidden md:flex border-b border-border px-8 py-3 items-center justify-between bg-white sticky top-0 z-10">
          <p className="text-xs text-muted font-mono">
            {loading
              ? <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse inline-block" />Loading...</span>
              : selectedClient ? selectedClient.name + ' · ' + dateLabel : ''}
          </p>
        </div>

        {/* Mobile top bar */}
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

        {/* Mobile hamburger */}
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

        {/* Page content */}
        <main className="flex-1 px-4 md:px-8 py-4 md:py-8 pb-20 md:pb-8">
          {selectedClient && (
            <h1 className="font-display text-2xl md:text-3xl text-ink mb-6">{selectedClient.name}</h1>
          )}

          {platformData && activeTab === 'overview' && (
            <OverviewTab data={platformData} googleAccountId={googleAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
          )}
          {platformData && activeTab === 'campaigns' && (
            <CampaignsTab data={platformData} googleAccountId={googleAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
          )}
          {activeTab === 'keywords' && activePlatform === 'google' && googleAccountId && (
            <KeywordsTab accountId={googleAccountId} dateRange={dateRange} />
          )}
          {activeTab === 'chat' && (
            <ChatTab messages={chatMessages} input={chatInput} loading={chatLoading} onInputChange={setChatInput}
              onSend={sendChat} accountSelected={!!selectedClient} onDownload={downloadChat} onUpload={uploadChat}
              exchangeCount={exchangeCount} platform={activePlatform} clientName={selectedClient?.name || ''} />
          )}
          {!platformData && !loading && selectedClient && activeTab !== 'keywords' && activeTab !== 'chat' && (
            <div className="flex items-center justify-center h-64"><p className="text-muted font-mono text-sm">Loading...</p></div>
          )}
          {!selectedClient && clients.length === 0 && (
            <div className="flex items-center justify-center h-64 flex-col gap-4">
              <p className="text-muted font-mono text-sm">No clients set up yet.</p>
              <a href="/clients" className="btn-primary text-sm">Set up clients →</a>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="flex items-center gap-2 text-muted font-mono text-sm">
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />Loading...
              </div>
            </div>
          )}
        </main>

        {/* Mobile bottom tabs */}
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
