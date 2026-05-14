'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

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

const CAMPAIGN_STATUSES: Record<string, string> = {
  '2': 'Active', '3': 'Paused', '4': 'Removed',
  'ENABLED': 'Active', 'PAUSED': 'Paused', 'REMOVED': 'Removed',
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: '▦' },
  { id: 'campaigns', label: 'Campaigns', icon: '◈' },
  { id: 'keywords', label: 'Keywords', icon: '⌖' },
  { id: 'chat', label: 'Ask Claude', icon: '✦' },
]

const CAMPAIGN_COLUMNS = [
  { id: 'spend', label: 'Spend', defaultOn: true },
  { id: 'clicks', label: 'Clicks', defaultOn: true },
  { id: 'ctr', label: 'CTR', defaultOn: true },
  { id: 'conversions', label: 'Conv.', defaultOn: true },
  { id: 'roas', label: 'ROAS', defaultOn: true },
  { id: 'impressions', label: 'Impressions', defaultOn: false },
  { id: 'avgCpc', label: 'Avg CPC', defaultOn: false },
  { id: 'costPerConv', label: 'Cost/Conv', defaultOn: false },
  { id: 'convRate', label: 'Conv Rate', defaultOn: false },
  { id: 'budget', label: 'Budget/day', defaultOn: false },
]

const KEYWORD_COLUMNS = [
  { id: 'spend', label: 'Spend', defaultOn: true },
  { id: 'clicks', label: 'Clicks', defaultOn: true },
  { id: 'ctr', label: 'CTR', defaultOn: true },
  { id: 'qs', label: 'QS', defaultOn: true },
  { id: 'impressions', label: 'Impressions', defaultOn: false },
  { id: 'avgCpc', label: 'Avg CPC', defaultOn: false },
  { id: 'conversions', label: 'Conv.', defaultOn: false },
  { id: 'costPerConv', label: 'Cost/Conv', defaultOn: false },
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
  platform_connections: {
    id: string
    platform: string
    account_id: string
    account_name: string
  }[]
}

// ─── Column Picker ────────────────────────────────────────────────────────────
function ColumnPicker({ columns, active, onChange }: {
  columns: { id: string; label: string; defaultOn: boolean }[]
  active: string[]
  onChange: (cols: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">
        ⊞ Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-48">
          <p className="font-mono text-xs text-muted uppercase tracking-wider mb-3">Show columns</p>
          {columns.map(col => (
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

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const label = CAMPAIGN_STATUSES[status] || status
  if (label === 'Active') return <span className="badge-good">● Active</span>
  if (label === 'Paused') return <span className="badge-warn">● Paused</span>
  return <span className="badge-bad">● {label}</span>
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
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

// ─── Platform Tabs ────────────────────────────────────────────────────────────
function PlatformTabs({ client, activePlatform, onChange }: {
  client: Client
  activePlatform: string
  onChange: (platform: string) => void
}) {
  const hasGoogle = client.platform_connections.some(p => p.platform === 'google')
  const hasMeta = client.platform_connections.some(p => p.platform === 'meta')
  const hasBoth = hasGoogle && hasMeta

  return (
    <div className="flex items-center gap-1 mb-6">
      {hasGoogle && (
        <button onClick={() => onChange('google')}
          className={'text-xs font-mono px-4 py-1.5 border transition-colors ' + (activePlatform === 'google' ? 'bg-ink text-white border-ink' : 'text-muted border-border hover:text-ink')}>
          🔵 Google Ads
        </button>
      )}
      {hasMeta && (
        <button onClick={() => onChange('meta')}
          className={'text-xs font-mono px-4 py-1.5 border transition-colors ' + (activePlatform === 'meta' ? 'bg-ink text-white border-ink' : 'text-muted border-border hover:text-ink')}>
          🔷 Meta Ads
        </button>
      )}
      {hasBoth && (
        <button onClick={() => onChange('combined')}
          className={'text-xs font-mono px-4 py-1.5 border transition-colors ' + (activePlatform === 'combined' ? 'bg-ink text-white border-ink' : 'text-muted border-border hover:text-ink')}>
          ⊕ Combined
        </button>
      )}
    </div>
  )
}

// ─── Meta Placeholder ─────────────────────────────────────────────────────────
function MetaPlaceholder({ clientName }: { clientName: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <p className="font-display text-xl text-ink mb-2">Meta Ads coming soon</p>
        <p className="text-sm text-muted font-mono">Connect a Meta ad account to {clientName} to see data here.</p>
        <a href="/clients" className="inline-block mt-4 text-xs font-mono text-accent hover:underline">
          Manage connections →
        </a>
      </div>
    </div>
  )
}

// ─── Performance Chart ────────────────────────────────────────────────────────
function PerformanceChart({ accountId, dateRange, campaignId, campaignName, customStart, customEnd }: {
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
    fetch(url)
      .then(r => r.json())
      .then(d => { setData((d.daily || []).map((row: any) => ({ ...row, date: String(row.date).slice(5) }))); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, dateRange, campaignId, granularity, customStart, customEnd])

  const toggleMetric = (id: string) => setActiveMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id])

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

// ─── Campaign Table ───────────────────────────────────────────────────────────
function CampaignTable({ campaigns, activeCols, selectedCampaignId, onSelectCampaign }: {
  campaigns: any[]; activeCols: string[]; selectedCampaignId?: string; onSelectCampaign?: (id: string, name: string) => void
}) {
  const has = (id: string) => activeCols.includes(id)
  const [sortCol, setSortCol] = useState<string>('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sorted = [...campaigns].sort((a, b) => {
    let av = 0, bv = 0
    if (sortCol === 'spend') { av = Number(a.cost); bv = Number(b.cost) }
    else if (sortCol === 'clicks') { av = Number(a.clicks); bv = Number(b.clicks) }
    else if (sortCol === 'ctr') { av = Number(a.ctr); bv = Number(b.ctr) }
    else if (sortCol === 'conversions') { av = Number(a.conversions); bv = Number(b.conversions) }
    else if (sortCol === 'roas') { av = Number(a.roas || 0); bv = Number(b.roas || 0) }
    else if (sortCol === 'impressions') { av = Number(a.impressions || 0); bv = Number(b.impressions || 0) }
    else if (sortCol === 'avgCpc') { av = Number(a.clicks) > 0 ? Number(a.cost) / Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.cost) / Number(b.clicks) : 0 }
    else if (sortCol === 'costPerConv') { av = Number(a.conversions) > 0 ? Number(a.cost) / Number(a.conversions) : 0; bv = Number(b.conversions) > 0 ? Number(b.cost) / Number(b.conversions) : 0 }
    else if (sortCol === 'convRate') { av = Number(a.clicks) > 0 ? Number(a.conversions) / Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.conversions) / Number(b.clicks) : 0 }
    else if (sortCol === 'budget') { av = Number(a.budget || 0); bv = Number(b.budget || 0) }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const SortTh = ({ id, label }: { id: string; label: string }) => (
    <th onClick={() => handleSort(id)} className="text-right px-3 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none whitespace-nowrap">
      {label}{sortCol === id ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )

  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface">Campaign</th>
            <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Status</th>
            {has('budget') && <SortTh id="budget" label="Budget/day" />}
            {has('impressions') && <SortTh id="impressions" label="Impressions" />}
            {has('spend') && <SortTh id="spend" label="Spend" />}
            {has('clicks') && <SortTh id="clicks" label="Clicks" />}
            {has('avgCpc') && <SortTh id="avgCpc" label="Avg CPC" />}
            {has('ctr') && <SortTh id="ctr" label="CTR" />}
            {has('conversions') && <SortTh id="conversions" label="Conv." />}
            {has('costPerConv') && <SortTh id="costPerConv" label="Cost/Conv" />}
            {has('convRate') && <SortTh id="convRate" label="Conv Rate" />}
            {has('roas') && <SortTh id="roas" label="ROAS" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c: any) => {
            const cost = Number(c.cost)
            const convs = Number(c.conversions)
            const clicks = Number(c.clicks)
            const isSelected = selectedCampaignId === c.id
            return (
              <tr key={c.id}
                onClick={() => onSelectCampaign && onSelectCampaign(isSelected ? '' : c.id, c.name)}
                className={'table-row ' + (onSelectCampaign ? 'cursor-pointer ' : '') + (isSelected ? 'bg-blue-50' : '')}>
                <td className={'px-3 py-3 font-medium max-w-[140px] md:max-w-xs truncate sticky left-0 ' + (isSelected ? 'bg-blue-50' : 'bg-white')}>
                  {isSelected && <span className="text-accent mr-1">▸</span>}
                  {c.name}
                </td>
                <td className="px-3 py-3 whitespace-nowrap"><StatusBadge status={c.status} /></td>
                {has('budget') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{c.budget ? '$' + c.budget : '—'}</td>}
                {has('impressions') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{Number(c.impressions || 0).toLocaleString()}</td>}
                {has('spend') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">${cost.toLocaleString()}</td>}
                {has('clicks') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{clicks.toLocaleString()}</td>}
                {has('avgCpc') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{clicks > 0 ? '$' + (cost / clicks).toFixed(2) : '—'}</td>}
                {has('ctr') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{c.ctr}%</td>}
                {has('conversions') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{convs.toFixed(1)}</td>}
                {has('costPerConv') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{convs > 0 ? '$' + (cost / convs).toFixed(2) : '—'}</td>}
                {has('convRate') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{clicks > 0 ? (convs / clicks * 100).toFixed(2) + '%' : '—'}</td>}
                {has('roas') && <td className="px-3 py-3 text-right font-mono text-sm font-medium whitespace-nowrap">{c.roas ? c.roas + 'x' : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ summary, accountId, dateRange, customStart, customEnd }: {
  summary: any; accountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const metrics = [
    { label: 'Total Spend', value: '$' + Number(summary.totalCost).toLocaleString() },
    { label: 'Clicks', value: Number(summary.totalClicks).toLocaleString() },
    { label: 'Impressions', value: Number(summary.totalImpressions).toLocaleString() },
    { label: 'Conversions', value: summary.totalConversions },
    { label: 'ROAS', value: summary.roas + 'x' },
    { label: 'Avg CTR', value: summary.avgCtr + '%' },
  ]
  const campaigns = summary.campaigns || []
  const topByCost = [...campaigns].sort((a: any, b: any) => Number(b.cost) - Number(a.cost)).slice(0, 5)
  const topByConv = [...campaigns].filter((c: any) => Number(c.conversions) > 0).sort((a: any, b: any) => Number(b.conversions) - Number(a.conversions)).slice(0, 5)
  const maxCost = topByCost.length > 0 ? Number(topByCost[0].cost) : 1
  const campaignsWithBudget = campaigns.filter((c: any) => c.budget && Number(c.budget) > 0).slice(0, 5)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const anomalies: string[] = []
  if (Number(summary.roas) < 0.5 && Number(summary.totalCost) > 100) anomalies.push('ROAS is critically low at ' + summary.roas + 'x')
  const pausedWithSpend = campaigns.filter((c: any) => (c.status === '3' || c.status === 'PAUSED') && Number(c.cost) > 0)
  if (pausedWithSpend.length > 0) anomalies.push(pausedWithSpend.length + ' paused campaign(s) recorded spend')
  const zeroConvHighSpend = campaigns.filter((c: any) => Number(c.conversions) === 0 && Number(c.cost) > 50)
  if (zeroConvHighSpend.length > 0) anomalies.push(zeroConvHighSpend.length + ' campaign(s) spent $50+ with zero conversions')
  const hasAnomalies = anomalies.length > 0
  const totalCostStr = '$' + Number(summary.totalCost).toLocaleString()
  const cpaStr = '$' + (Number(summary.totalCost) / Math.max(Number(summary.totalConversions), 1)).toFixed(2)

  return (
    <div className="space-y-4 md:space-y-6">
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
                {greeting}. Your account is running normally — <strong>{totalCostStr}</strong> spent,{' '}
                <strong>{summary.totalConversions}</strong> conversions at <strong>{cpaStr}</strong> per conversion.{' '}
                {summary.activeCampaigns} active campaigns.
              </p>
            )}
          </div>
          <span className="text-xs font-mono text-muted ml-4 mt-0.5 whitespace-nowrap hidden md:block">AI analysis coming soon</span>
        </div>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-3 md:p-5">
            <div className="metric-label mb-1 md:mb-2 text-xs">{m.label}</div>
            <div className="text-lg md:text-2xl font-display text-accent">{m.value}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Campaign Performance</h3>
          <div className="space-y-3">
            {topByCost.map((c: any) => (
              <div key={c.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-ink truncate max-w-[65%]">{c.name}</span>
                  <span className="text-xs font-mono text-muted">${Number(c.cost).toLocaleString()}</span>
                </div>
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full" style={{ width: (Number(c.cost) / maxCost * 100) + '%' }} />
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
              {topByConv.map((c: any) => {
                const cpa = Number(c.conversions) > 0 ? (Number(c.cost) / Number(c.conversions)).toFixed(2) : null
                return (
                  <div key={c.id} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                    <span className="text-xs text-ink truncate max-w-[55%]">{c.name}</span>
                    <div className="text-right">
                      <span className="text-xs font-mono text-accent font-medium">{Number(c.conversions).toFixed(1)} conv</span>
                      {cpa && <span className="text-xs font-mono text-muted ml-2">${cpa}/conv</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Top Keywords by Spend</h3>
          <TopKeywordsCard accountId={accountId} dateRange={dateRange} />
        </div>
        <div className="bg-white border border-border p-4 md:p-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Budget Utilization</h3>
          {campaignsWithBudget.length === 0 ? (
            <p className="text-xs text-muted font-mono">No budget data available</p>
          ) : (
            <div className="space-y-3">
              {campaignsWithBudget.map((c: any) => {
                const pct = Math.min((Number(c.cost) / (Number(c.budget) * 30)) * 100, 100)
                const barColor = pct > 90 ? '#dc2626' : pct > 70 ? '#f59e0b' : '#2563eb'
                return (
                  <div key={c.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-ink truncate max-w-[60%]">{c.name}</span>
                      <span className="text-xs font-mono text-muted">${c.budget}/day</span>
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
      <PerformanceChart accountId={accountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
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
function CampaignsTab({ campaigns, accountId, dateRange, customStart, customEnd }: {
  campaigns: any[]; accountId: string; dateRange: string; customStart?: string; customEnd?: string
}) {
  const defaultCols = CAMPAIGN_COLUMNS.filter(c => c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('advar-campaign-cols') || 'null') || defaultCols } catch { return defaultCols }
    }
    return defaultCols
  })
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>('')
  const updateCols = (cols: string[]) => { setActiveCols(cols); if (typeof window !== 'undefined') localStorage.setItem('advar-campaign-cols', JSON.stringify(cols)) }
  const handleSelectCampaign = (id: string, name: string) => { setSelectedCampaignId(id); setSelectedCampaignName(id ? name : '') }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Campaigns</h2>
          <p className="text-sm text-muted font-mono">
            {campaigns.length} campaigns
            {selectedCampaignName && <span className="text-accent"> · {selectedCampaignName}</span>}
          </p>
        </div>
        <ColumnPicker columns={CAMPAIGN_COLUMNS} active={activeCols} onChange={updateCols} />
      </div>
      <PerformanceChart accountId={accountId} dateRange={dateRange} campaignId={selectedCampaignId || undefined} campaignName={selectedCampaignName || undefined} customStart={customStart} customEnd={customEnd} />
      <CampaignTable campaigns={campaigns} activeCols={activeCols} selectedCampaignId={selectedCampaignId} onSelectCampaign={handleSelectCampaign} />
    </div>
  )
}

// ─── Keywords Tab ─────────────────────────────────────────────────────────────
function KeywordsTab({ accountId, dateRange }: { accountId: string; dateRange: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const defaultCols = KEYWORD_COLUMNS.filter(c => c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('advar-keyword-cols') || 'null') || defaultCols } catch { return defaultCols }
    }
    return defaultCols
  })
  const [sortCol, setSortCol] = useState<string>('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const updateCols = (cols: string[]) => { setActiveCols(cols); if (typeof window !== 'undefined') localStorage.setItem('advar-keyword-cols', JSON.stringify(cols)) }
  const has = (id: string) => activeCols.includes(id)

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

  const sortedKw = [...keywords].sort((a, b) => {
    let av = 0, bv = 0
    if (sortCol === 'spend') { av = Number(a.cost); bv = Number(b.cost) }
    else if (sortCol === 'clicks') { av = Number(a.clicks); bv = Number(b.clicks) }
    else if (sortCol === 'ctr') { av = Number(a.ctr); bv = Number(b.ctr) }
    else if (sortCol === 'qs') { av = Number(a.qualityScore || 0); bv = Number(b.qualityScore || 0) }
    else if (sortCol === 'impressions') { av = Number(a.impressions || 0); bv = Number(b.impressions || 0) }
    else if (sortCol === 'avgCpc') { av = Number(a.clicks) > 0 ? Number(a.cost) / Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.cost) / Number(b.clicks) : 0 }
    else if (sortCol === 'conversions') { av = Number(a.conversions || 0); bv = Number(b.conversions || 0) }
    else if (sortCol === 'costPerConv') { av = Number(a.conversions) > 0 ? Number(a.cost) / Number(a.conversions) : 0; bv = Number(b.conversions) > 0 ? Number(b.cost) / Number(b.conversions) : 0 }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const KwSortTh = ({ id, label }: { id: string; label: string }) => (
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
        <ColumnPicker columns={KEYWORD_COLUMNS} active={activeCols} onChange={updateCols} />
      </div>
      {loading ? (
        <div className="text-muted text-sm font-mono">Loading keywords...</div>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider sticky left-0 bg-surface whitespace-nowrap">Keyword</th>
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider whitespace-nowrap">Match</th>
                <th className="text-left px-3 py-3 font-mono text-xs text-muted tracking-wider hidden md:table-cell whitespace-nowrap">Campaign</th>
                {has('impressions') && <KwSortTh id="impressions" label="Impr." />}
                {has('spend') && <KwSortTh id="spend" label="Spend" />}
                {has('clicks') && <KwSortTh id="clicks" label="Clicks" />}
                {has('avgCpc') && <KwSortTh id="avgCpc" label="Avg CPC" />}
                {has('ctr') && <KwSortTh id="ctr" label="CTR" />}
                {has('conversions') && <KwSortTh id="conversions" label="Conv." />}
                {has('costPerConv') && <KwSortTh id="costPerConv" label="Cost/Conv" />}
                {has('qs') && <KwSortTh id="qs" label="QS" />}
              </tr>
            </thead>
            <tbody>
              {sortedKw.map((k: any, i: number) => (
                <tr key={i} className="table-row">
                  <td className="px-3 py-3 font-medium sticky left-0 bg-white max-w-[120px] truncate">{k.text}</td>
                  <td className="px-3 py-3 text-xs font-mono text-muted whitespace-nowrap">{matchLabel(k.matchType)}</td>
                  <td className="px-3 py-3 text-xs text-muted truncate max-w-xs hidden md:table-cell">{k.campaign}</td>
                  {has('impressions') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{Number(k.impressions || 0).toLocaleString()}</td>}
                  {has('spend') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">${k.cost}</td>}
                  {has('clicks') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{k.clicks}</td>}
                  {has('avgCpc') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{Number(k.clicks) > 0 ? '$' + (Number(k.cost) / Number(k.clicks)).toFixed(2) : '—'}</td>}
                  {has('ctr') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{k.ctr}%</td>}
                  {has('conversions') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{k.conversions || '—'}</td>}
                  {has('costPerConv') && <td className="px-3 py-3 text-right font-mono text-sm whitespace-nowrap">{Number(k.conversions) > 0 ? '$' + (Number(k.cost) / Number(k.conversions)).toFixed(2) : '—'}</td>}
                  {has('qs') && (
                    <td className="px-3 py-3 text-right font-mono text-sm font-medium whitespace-nowrap">
                      {k.qualityScore ? (
                        <span title="Quality Score" className={'cursor-help ' + qsColor(k.qualityScore)}>{k.qualityScore}</span>
                      ) : <span className="text-muted">—</span>}
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
function ChatTab({ messages, input, loading, onInputChange, onSend, accountSelected, onDownload, onUpload, exchangeCount }: any) {
  const atLimit = exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0
  const warningNext = exchangeCount % 4 === 3 && exchangeCount > 0 && messages.length > 0
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-xl md:text-2xl text-ink mb-1">Ask Claude</h2>
          <p className="text-sm text-muted font-mono">Ask questions about your campaigns</p>
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
          <p className="text-sm text-red-700 font-semibold">
            ⚠️ 1 exchange remaining.{' '}
            <button onClick={onDownload} className="underline font-bold">Save transcript</button>
            {' '}now.
          </p>
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
              <p className="text-ink">"What keywords are wasting budget?"</p>
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
            placeholder={accountSelected ? (atLimit ? 'Download and re-upload to continue...' : 'Ask about this account...') : 'Select a client first'}
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
  const [activePlatform, setActivePlatform] = useState<string>('google')
  const [dateRange, setDateRange] = useState<string>('LAST_30_DAYS')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
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
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat'>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)

  useEffect(() => {
    const dr = searchParams.get('range')
    const tab = searchParams.get('tab')
    if (dr) setDateRange(dr)
    if (tab) setActiveTab(tab as any)
  }, [])

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])
  useEffect(() => { if (session) fetchClients() }, [session])

  async function fetchClients() {
    try {
      const res = await fetch('/api/clients')
      const data = await res.json()
      const clientList = data.clients || []
      setClients(clientList)
      // Auto-select first client
      const savedClientId = localStorage.getItem('advar-active-client')
      const saved = clientList.find((c: Client) => c.id === savedClientId)
      const toSelect = saved || clientList[0] || null
      if (toSelect) selectClient(toSelect)
    } catch (e) { console.error(e) }
  }

  function selectClient(client: Client) {
    setSelectedClient(client)
    localStorage.setItem('advar-active-client', client.id)
    // Reset chat if switching clients
    const savedClient = localStorage.getItem('advar-active-client')
    if (savedClient && savedClient !== client.id) {
      setChatMessages([])
      setSessionStart(0)
      localStorage.removeItem('advar-chat-messages')
      localStorage.removeItem('advar-session-start')
    }
    // Default to google if available
    const hasGoogle = client.platform_connections.some(p => p.platform === 'google')
    setActivePlatform(hasGoogle ? 'google' : 'meta')
    // Load data
    const googleConn = client.platform_connections.find(p => p.platform === 'google')
    if (googleConn) {
      if (dateRange === 'CUSTOM' && customStart && customEnd) {
        fetchSummaryCustom(googleConn.account_id, customStart, customEnd)
      } else {
        fetchSummary(googleConn.account_id, dateRange)
      }
    }
  }

  async function fetchSummary(accountId: string, dr: string) {
    setLoading(true); setSummary(null)
    try {
      const res = await fetch('/api/campaigns?accountId=' + accountId + '&dateRange=' + dr)
      setSummary(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function fetchSummaryCustom(accountId: string, start: string, end: string) {
    setLoading(true); setSummary(null)
    try {
      const res = await fetch('/api/campaigns?accountId=' + accountId + '&dateRange=LAST_30_DAYS&customStart=' + start + '&customEnd=' + end)
      setSummary(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  function handleDateRangeChange(val: string) {
    setDateRange(val)
    if (val === 'CUSTOM') setShowCustomPicker(true)
    else {
      setCustomStart(''); setCustomEnd('')
      const googleConn = selectedClient?.platform_connections.find(p => p.platform === 'google')
      if (googleConn) fetchSummary(googleConn.account_id, val)
    }
  }

  function applyCustomRange() {
    if (customStart && customEnd && selectedClient) {
      const googleConn = selectedClient.platform_connections.find(p => p.platform === 'google')
      if (googleConn) fetchSummaryCustom(googleConn.account_id, customStart, customEnd)
    }
  }

  useEffect(() => {
    if (chatMessages.length > 0) localStorage.setItem('advar-chat-messages', JSON.stringify(chatMessages))
  }, [chatMessages])
  useEffect(() => { localStorage.setItem('advar-session-start', String(sessionStart)) }, [sessionStart])

  function switchTab(tab: 'overview' | 'campaigns' | 'keywords' | 'chat') {
    setActiveTab(tab)
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
        body: JSON.stringify({ message: userMsg, accountId: googleConn?.account_id, summary, dateRange, history: history.slice(0, -1), accountName: selectedClient.name }),
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
  const activeAccountId = googleConn?.account_id || ''

  return (
    <div className="min-h-screen bg-paper flex">

      {/* ─── Desktop Sidebar ─── */}
      <div className={`hidden md:flex flex-col border-r border-border bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`} style={{ minHeight: '100vh', position: 'sticky', top: 0 }}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          {!sidebarCollapsed && <span className="font-display text-lg text-ink">Advar</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-muted hover:text-ink transition-colors ml-auto">
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        {/* Date range */}
        {!sidebarCollapsed && (
          <div className="px-3 py-2 border-b border-border">
            <select value={dateRange} onChange={e => handleDateRangeChange(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent">
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

        {/* Nav */}
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => switchTab(item.id as any)} title={sidebarCollapsed ? item.label : undefined}
              className={'w-full flex items-center gap-3 px-4 py-2.5 transition-colors ' + (activeTab === item.id ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-surface')}>
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Client list */}
        <div className="border-t border-border">
          {!sidebarCollapsed && (
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="font-mono text-xs text-muted uppercase tracking-wider">Clients</span>
              <a href="/clients" className="text-xs text-accent hover:underline font-mono">+ Edit</a>
            </div>
          )}
          <div className="pb-2 max-h-48 overflow-y-auto">
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
        <div className="border-t border-border py-2">
          <button onClick={() => { const conn = selectedClient?.platform_connections.find(p => p.platform === 'google'); if (conn) { dateRange === 'CUSTOM' && customStart && customEnd ? fetchSummaryCustom(conn.account_id, customStart, customEnd) : fetchSummary(conn.account_id, dateRange) } }} title="Refresh"
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

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Desktop top bar */}
        <div className="hidden md:flex border-b border-border px-8 py-3 items-center justify-between bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted font-mono">
              {loading
                ? <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse inline-block" />Loading...</span>
                : selectedClient ? selectedClient.name + ' · ' + (dateRange === 'CUSTOM' && customStart && customEnd ? customStart + ' – ' + customEnd : (DATE_RANGES.find(d => d.value === dateRange)?.label || '')) : ''}
            </p>
          </div>
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

        {/* Mobile hamburger menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-border px-4 py-3 space-y-2 sticky top-14 z-10">
            <select value={dateRange} onChange={e => handleDateRangeChange(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono text-ink">
              {DATE_RANGES.map(dr => <option key={dr.value} value={dr.value}>{dr.label}</option>)}
            </select>
            {showCustomPicker && (
              <div className="space-y-1">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono" />
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-2 font-mono" />
                <button onClick={() => { applyCustomRange(); setMobileMenuOpen(false) }} className="w-full btn-primary text-xs py-2">Apply</button>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { const conn = selectedClient?.platform_connections.find(p => p.platform === 'google'); if (conn) fetchSummary(conn.account_id, dateRange); setMobileMenuOpen(false) }}
                className="flex-1 text-xs font-mono text-muted border border-border py-2 hover:text-ink">↻ Refresh</button>
              <button onClick={() => signOut({ callbackUrl: '/' })}
                className="flex-1 text-xs font-mono text-muted border border-border py-2 hover:text-ink">Sign out</button>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 px-4 md:px-8 py-4 md:py-8 pb-20 md:pb-8">
          {selectedClient && (
            <div className="mb-2">
              <h1 className="font-display text-2xl md:text-3xl text-ink mb-3">{selectedClient.name}</h1>
              <PlatformTabs client={selectedClient} activePlatform={activePlatform} onChange={setActivePlatform} />
            </div>
          )}

          {activePlatform === 'meta' && selectedClient && <MetaPlaceholder clientName={selectedClient.name} />}

          {activePlatform === 'google' && (
            <>
              {activeTab === 'overview' && summary && activeAccountId && (
                <OverviewTab summary={summary} accountId={activeAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
              )}
              {activeTab === 'campaigns' && summary && activeAccountId && (
                <CampaignsTab campaigns={summary.campaigns || []} accountId={activeAccountId} dateRange={dateRange} customStart={customStart} customEnd={customEnd} />
              )}
              {activeTab === 'keywords' && activeAccountId && <KeywordsTab accountId={activeAccountId} dateRange={dateRange} />}
              {activeTab === 'chat' && (
                <ChatTab messages={chatMessages} input={chatInput} loading={chatLoading} onInputChange={setChatInput}
                  onSend={sendChat} accountSelected={!!activeAccountId} onDownload={downloadChat} onUpload={uploadChat} exchangeCount={exchangeCount} />
              )}
              {!summary && !loading && activeAccountId && <div className="flex items-center justify-center h-64"><p className="text-muted font-mono text-sm">Loading account data...</p></div>}
            </>
          )}

          {!selectedClient && clients.length === 0 && (
            <div className="flex items-center justify-center h-64 flex-col gap-4">
              <p className="text-muted font-mono text-sm">No clients set up yet.</p>
              <a href="/clients" className="btn-primary text-sm">Set up clients →</a>
            </div>
          )}
        </main>

        {/* Mobile bottom tab bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border z-20">
          <div className="flex">
            {NAV_ITEMS.map(item => (
              <button key={item.id} onClick={() => { switchTab(item.id as any); setMobileMenuOpen(false) }}
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
            <div className="border-t border-border bg-white px-4 py-3 space-y-2">
              <p className="font-mono text-xs text-muted uppercase tracking-wider">Coming soon</p>
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
