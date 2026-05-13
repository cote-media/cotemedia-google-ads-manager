'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const DATE_RANGES = [
  { label: 'Last 7 days', value: 'LAST_7_DAYS' },
  { label: 'Last 14 days', value: 'LAST_14_DAYS' },
  { label: 'Last 30 days', value: 'LAST_30_DAYS' },
  { label: 'This month', value: 'THIS_MONTH' },
  { label: 'Last month', value: 'LAST_MONTH' },
  { label: 'Last 90 days', value: 'LAST_90_DAYS' },
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

// ─── Column Picker ────────────────────────────────────────────────────────────
function ColumnPicker({ columns, active, onChange }: {
  columns: { id: string; label: string; defaultOn: boolean }[]
  active: string[]
  onChange: (cols: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors"
      >
        ⊞ Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 bg-white border border-border shadow-lg z-20 p-4 w-48">
          <p className="font-mono text-xs text-muted uppercase tracking-wider mb-3">Show columns</p>
          {columns.map(col => (
            <label key={col.id} className="flex items-center gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={active.includes(col.id)}
                onChange={e => {
                  if (e.target.checked) onChange([...active, col.id])
                  else onChange(active.filter(c => c !== col.id))
                }}
                className="accent-accent"
              />
              <span className="text-xs text-ink">{col.label}</span>
            </label>
          ))}
          <button onClick={() => setOpen(false)} className="mt-3 text-xs text-muted hover:text-ink font-mono">
            Done
          </button>
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

// ─── Campaign Table ───────────────────────────────────────────────────────────
function CampaignTable({ campaigns, activeCols }: {
  campaigns: any[]
  activeCols: string[]
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
    else if (sortCol === 'avgCpc') { av = Number(a.clicks) > 0 ? Number(a.cost)/Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.cost)/Number(b.clicks) : 0 }
    else if (sortCol === 'costPerConv') { av = Number(a.conversions) > 0 ? Number(a.cost)/Number(a.conversions) : 0; bv = Number(b.conversions) > 0 ? Number(b.cost)/Number(b.conversions) : 0 }
    else if (sortCol === 'convRate') { av = Number(a.clicks) > 0 ? Number(a.conversions)/Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.conversions)/Number(b.clicks) : 0 }
    else if (sortCol === 'budget') { av = Number(a.budget || 0); bv = Number(b.budget || 0) }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const SortTh = ({ id, label, left }: { id: string, label: string, left?: boolean }) => (
    <th onClick={() => handleSort(id)} className={`${left ? 'text-left' : 'text-right'} px-4 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none`}>
      {label} {sortCol === id ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )
  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Campaign</th>
            <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Status</th>
            {has('budget') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Budget/day</th>}
            {has('impressions') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Impressions</th>}
            {has('spend') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Spend</th>}
            {has('clicks') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Clicks</th>}
            {has('avgCpc') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Avg CPC</th>}
            {has('ctr') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">CTR</th>}
            {has('conversions') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Conv.</th>}
            {has('costPerConv') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Cost/Conv</th>}
            {has('convRate') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Conv Rate</th>}
            {has('roas') && <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c: any) => {
            const cost = Number(c.cost)
            const convs = Number(c.conversions)
            const clicks = Number(c.clicks)
            return (
              <tr key={c.id} className="table-row">
                <td className="px-4 py-3 font-medium max-w-xs truncate">{c.name}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                {has('budget') && <td className="px-4 py-3 text-right font-mono text-sm">{c.budget ? '$' + c.budget : '—'}</td>}
                {has('impressions') && <td className="px-4 py-3 text-right font-mono text-sm">{Number(c.impressions || 0).toLocaleString()}</td>}
                {has('spend') && <td className="px-4 py-3 text-right font-mono text-sm">${cost.toLocaleString()}</td>}
                {has('clicks') && <td className="px-4 py-3 text-right font-mono text-sm">{clicks.toLocaleString()}</td>}
                {has('avgCpc') && <td className="px-4 py-3 text-right font-mono text-sm">{clicks > 0 ? '$' + (cost / clicks).toFixed(2) : '—'}</td>}
                {has('ctr') && <td className="px-4 py-3 text-right font-mono text-sm">{c.ctr}%</td>}
                {has('conversions') && <td className="px-4 py-3 text-right font-mono text-sm">{convs.toFixed(1)}</td>}
                {has('costPerConv') && <td className="px-4 py-3 text-right font-mono text-sm">{convs > 0 ? '$' + (cost / convs).toFixed(2) : '—'}</td>}
                {has('convRate') && <td className="px-4 py-3 text-right font-mono text-sm">{clicks > 0 ? (convs / clicks * 100).toFixed(2) + '%' : '—'}</td>}
                {has('roas') && <td className="px-4 py-3 text-right font-mono text-sm font-medium">{c.roas ? c.roas + 'x' : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ summary }: { summary: any }) {
  const metrics = [
    { label: 'Total Spend', value: '$' + Number(summary.totalCost).toLocaleString() },
    { label: 'Clicks', value: Number(summary.totalClicks).toLocaleString() },
    { label: 'Impressions', value: Number(summary.totalImpressions).toLocaleString() },
    { label: 'Conversions', value: summary.totalConversions },
    { label: 'ROAS', value: summary.roas + 'x' },
    { label: 'Avg CTR', value: summary.avgCtr + '%' },
  ]
  const defaultCols = ['spend', 'clicks', 'ctr', 'conversions', 'roas']
  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-ink mb-1">Account Overview</h2>
        <p className="text-sm text-muted font-mono">{summary.activeCampaigns} active campaigns</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border mb-8">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-5">
            <div className="metric-label mb-2">{m.label}</div>
            <div className="metric-value text-accent">{m.value}</div>
          </div>
        ))}
      </div>
      <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Top Campaigns by Spend</h3>
      <CampaignTable campaigns={(summary.campaigns || []).slice(0, 10)} activeCols={defaultCols} />
    </div>
  )
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────
function CampaignsTab({ campaigns }: { campaigns: any[] }) {
  const defaultCols = CAMPAIGN_COLUMNS.filter(c => c.defaultOn).map(c => c.id)
  const [activeCols, setActiveCols] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('advar-campaign-cols')
        return saved ? JSON.parse(saved) : defaultCols
      } catch { return defaultCols }
    }
    return defaultCols
  })
  const updateCols = (cols: string[]) => {
    setActiveCols(cols)
    if (typeof window !== 'undefined') localStorage.setItem('advar-campaign-cols', JSON.stringify(cols))
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink mb-1">Campaigns</h2>
          <p className="text-sm text-muted font-mono">{campaigns.length} campaigns</p>
        </div>
        <ColumnPicker columns={CAMPAIGN_COLUMNS} active={activeCols} onChange={updateCols} />
      </div>
      <CampaignTable campaigns={campaigns} activeCols={activeCols} />
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
      try {
        const saved = localStorage.getItem('advar-keyword-cols')
        return saved ? JSON.parse(saved) : defaultCols
      } catch { return defaultCols }
    }
    return defaultCols
  })
  const updateCols = (cols: string[]) => {
    setActiveCols(cols)
    if (typeof window !== 'undefined') localStorage.setItem('advar-keyword-cols', JSON.stringify(cols))
  }
  const has = (id: string) => activeCols.includes(id)
  const [sortCol, setSortCol] = useState<string>('spend')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')

  function handleKwSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const KwSortTh = ({ id, label, left }: { id: string, label: string, left?: boolean }) => (
    <th onClick={() => handleKwSort(id)} className={`${left ? 'text-left' : 'text-right'} px-4 py-3 font-mono text-xs text-muted tracking-wider cursor-pointer hover:text-ink select-none`}>
      {label} {sortCol === id ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  )

  useEffect(() => {
    setLoading(true)
    fetch('/api/keywords?accountId=' + accountId + '&dateRange=' + dateRange)
      .then(r => r.json())
      .then(d => { setKeywords(d.keywords || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId, dateRange])

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

  const sortedKw = [...keywords].sort((a, b) => {
    let av = 0, bv = 0
    if (sortCol === 'spend') { av = Number(a.cost); bv = Number(b.cost) }
    else if (sortCol === 'clicks') { av = Number(a.clicks); bv = Number(b.clicks) }
    else if (sortCol === 'ctr') { av = Number(a.ctr); bv = Number(b.ctr) }
    else if (sortCol === 'qs') { av = Number(a.qualityScore || 0); bv = Number(b.qualityScore || 0) }
    else if (sortCol === 'impressions') { av = Number(a.impressions || 0); bv = Number(b.impressions || 0) }
    else if (sortCol === 'avgCpc') { av = Number(a.clicks) > 0 ? Number(a.cost)/Number(a.clicks) : 0; bv = Number(b.clicks) > 0 ? Number(b.cost)/Number(b.clicks) : 0 }
    else if (sortCol === 'conversions') { av = Number(a.conversions || 0); bv = Number(b.conversions || 0) }
    else if (sortCol === 'costPerConv') { av = Number(a.conversions) > 0 ? Number(a.cost)/Number(a.conversions) : 0; bv = Number(b.conversions) > 0 ? Number(b.cost)/Number(b.conversions) : 0 }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-ink mb-1">Keywords</h2>
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
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Keyword</th>
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Match</th>
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Campaign</th>
                {has('impressions') && <KwSortTh id="impressions" label="Impressions" />}
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
                  <td className="px-4 py-3 font-medium">{k.text}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted">{matchLabel(k.matchType)}</td>
                  <td className="px-4 py-3 text-xs text-muted truncate max-w-xs">{k.campaign}</td>
                  {has('impressions') && <td className="px-4 py-3 text-right font-mono text-sm">{Number(k.impressions || 0).toLocaleString()}</td>}
                  {has('spend') && <td className="px-4 py-3 text-right font-mono text-sm">${k.cost}</td>}
                  {has('clicks') && <td className="px-4 py-3 text-right font-mono text-sm">{k.clicks}</td>}
                  {has('avgCpc') && <td className="px-4 py-3 text-right font-mono text-sm">{Number(k.clicks) > 0 ? '$' + (Number(k.cost) / Number(k.clicks)).toFixed(2) : '—'}</td>}
                  {has('ctr') && <td className="px-4 py-3 text-right font-mono text-sm">{k.ctr}%</td>}
                  {has('conversions') && <td className="px-4 py-3 text-right font-mono text-sm">{k.conversions || '—'}</td>}
                  {has('costPerConv') && <td className="px-4 py-3 text-right font-mono text-sm">{Number(k.conversions) > 0 ? '$' + (Number(k.cost) / Number(k.conversions)).toFixed(2) : '—'}</td>}
                  {has('qs') && (
                    <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                      {k.qualityScore ? (
                        <span title="Quality Score: Google's 1-10 rating of keyword relevance. Higher = cheaper clicks." className={'cursor-help ' + qsColor(k.qualityScore)}>
                          {k.qualityScore}
                        </span>
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
          <h2 className="font-display text-2xl text-ink mb-1">Ask Claude</h2>
          <p className="text-sm text-muted font-mono">Ask questions about your campaigns in plain English</p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors cursor-pointer">
            ↑ Resume chat
            <input type="file" accept=".txt" onChange={onUpload} className="hidden" />
          </label>
          {messages.length > 0 && (
            <button onClick={onDownload} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">
              ↓ Save chat
            </button>
          )}
        </div>
      </div>
      {warningNext && (
        <div className="mb-4 bg-red-50 border-2 border-red-400 px-4 py-3">
          <p className="text-sm text-red-700 font-semibold">
            ⚠️ 1 exchange remaining.{' '}
            <button onClick={onDownload} className="underline font-bold">Save transcript</button>
            {' '}now so you can continue this analysis.
          </p>
        </div>
      )}
      {atLimit && (
        <div className="mb-4 bg-ink px-6 py-5 text-center">
          <p className="text-paper font-semibold mb-1">You've used all 4 exchanges.</p>
          <p className="text-paper text-sm mb-4 opacity-80">Download your transcript, then re-upload it to start a fresh 4 exchanges with full context.</p>
          <button onClick={onDownload} className="bg-paper text-ink text-sm font-mono px-5 py-2 hover:bg-surface transition-colors">↓ Download transcript</button>
        </div>
      )}
      <div className="bg-white border border-border flex flex-col" style={{ height: 'calc(100vh - 280px)' }}>
        <div id="chat-messages" className="flex-1 p-6 space-y-4 overflow-y-auto">
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
              <div className={'px-6 py-4 text-sm leading-7 ' + (m.role === 'user' ? 'bg-ink text-paper max-w-xl' : 'bg-surface text-ink border border-border w-full chat-response')}>
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
        <div className="border-t border-border p-4 flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !atLimit && onSend()}
            placeholder={accountSelected ? (atLimit ? 'Download transcript and re-upload to continue...' : 'Ask about this account...') : 'Select an account first'}
            disabled={!accountSelected || atLimit}
            className="flex-1 border border-border px-4 py-2.5 text-sm bg-paper focus:outline-none focus:border-accent font-sans disabled:opacity-50"
          />
          <button onClick={onSend} disabled={!accountSelected || loading || atLimit} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            Send
          </button>
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

  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<string>('LAST_30_DAYS')
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

  // Restore from URL
  useEffect(() => {
    const acc = searchParams.get('account')
    const dr = searchParams.get('range')
    const tab = searchParams.get('tab')
    if (dr) setDateRange(dr)
    if (tab) setActiveTab(tab as any)
    if (acc) setSelectedAccount(acc)
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  useEffect(() => {
    if (session) fetchAccounts()
  }, [session])

  useEffect(() => {
    if (!selectedAccount) return
    const savedAccount = localStorage.getItem('advar-active-account')
    if (savedAccount && savedAccount !== selectedAccount && savedAccount !== 'null') {
      setChatMessages([])
      setSessionStart(0)
      localStorage.removeItem('advar-chat-messages')
      localStorage.removeItem('advar-session-start')
    }
    localStorage.setItem('advar-active-account', selectedAccount)
    fetchSummary(selectedAccount, dateRange)
    const params = new URLSearchParams()
    params.set('account', selectedAccount)
    params.set('range', dateRange)
    params.set('tab', activeTab)
    router.replace('/dashboard?' + params.toString(), { scroll: false })
  }, [selectedAccount, dateRange])

  useEffect(() => {
    if (chatMessages.length > 0) localStorage.setItem('advar-chat-messages', JSON.stringify(chatMessages))
  }, [chatMessages])

  useEffect(() => {
    localStorage.setItem('advar-session-start', String(sessionStart))
  }, [sessionStart])

  function switchTab(tab: 'overview' | 'campaigns' | 'keywords' | 'chat') {
    setActiveTab(tab)
    if (selectedAccount) {
      const params = new URLSearchParams()
      params.set('account', selectedAccount)
      params.set('range', dateRange)
      params.set('tab', tab)
      router.replace('/dashboard?' + params.toString(), { scroll: false })
    }
  }

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
      const urlAccount = new URLSearchParams(window.location.search).get('account')
      if (data.accounts?.length > 0 && !urlAccount) setSelectedAccount(data.accounts[0].id)
      else if (urlAccount) setSelectedAccount(urlAccount)
    } catch (e) { console.error(e) }
  }

  async function fetchSummary(accountId: string, dr: string) {
    setLoading(true)
    setSummary(null)
    try {
      const res = await fetch('/api/campaigns?accountId=' + accountId + '&dateRange=' + dr)
      const data = await res.json()
      setSummary(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function sendChat() {
    if (!chatInput.trim() || !selectedAccount) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }]
    setChatMessages(newMessages)
    setChatLoading(true)
    const history = newMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
    const accountName = accounts.find((a: any) => a.id === selectedAccount)?.name || selectedAccount
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, accountId: selectedAccount, summary, dateRange, history: history.slice(0, -1), accountName }),
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally { setChatLoading(false) }
  }

  function downloadChat() {
    const accountName = accounts.find((a: any) => a.id === selectedAccount)?.name || selectedAccount
    const text = chatMessages.map(m => (m.role === 'user' ? 'You' : 'Claude') + ': ' + m.content).join('\n\n---\n\n')
    const header = 'Advar Chat Export\nAccount: ' + accountName + '\nDate: ' + new Date().toLocaleDateString() + '\n\n'
    const blob = new Blob([header + text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'advar-' + String(accountName).replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + new Date().toISOString().split('T')[0] + '.txt'
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
  const selectedAccountName = accounts.find((a: any) => a.id === selectedAccount)?.name || 'Select account'

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Sidebar */}
      <div className={`flex flex-col border-r border-border bg-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-56'}`} style={{ minHeight: '100vh', position: 'sticky', top: 0 }}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          {!sidebarCollapsed && <span className="font-display text-lg text-ink">Advar</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="text-muted hover:text-ink transition-colors ml-auto" title={sidebarCollapsed ? 'Expand' : 'Collapse'}>
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>
        <div className="px-3 py-3 border-b border-border">
          {sidebarCollapsed ? (
            <div className="w-8 h-8 bg-accent rounded flex items-center justify-center text-white text-xs font-bold mx-auto" title={selectedAccountName}>
              {selectedAccountName.charAt(0)}
            </div>
          ) : (
            <select value={selectedAccount || ''} onChange={e => setSelectedAccount(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent">
              {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="px-3 py-2 border-b border-border">
            <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="w-full text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent">
              {DATE_RANGES.map(dr => <option key={dr.value} value={dr.value}>{dr.label}</option>)}
            </select>
          </div>
        )}
        <nav className="flex-1 py-2">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => switchTab(item.id as any)} title={sidebarCollapsed ? item.label : undefined}
              className={'w-full flex items-center gap-3 px-4 py-2.5 transition-colors ' + (activeTab === item.id ? 'bg-accent text-white' : 'text-muted hover:text-ink hover:bg-surface')}>
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {!sidebarCollapsed && <span className="font-mono text-xs tracking-wide uppercase">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="border-t border-border py-2">
          <button onClick={() => selectedAccount && fetchSummary(selectedAccount, dateRange)} title="Refresh data"
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
        <div className="border-b border-border px-8 py-3 flex items-center justify-between bg-white sticky top-0 z-10">
          <p className="text-xs text-muted font-mono">
            {loading
              ? <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse inline-block" />Loading...</span>
              : summary ? selectedAccountName + ' · ' + (DATE_RANGES.find(d => d.value === dateRange)?.label || '') : ''
            }
          </p>
          {sidebarCollapsed && (
            <select value={dateRange} onChange={e => setDateRange(e.target.value)} className="text-xs border border-border bg-paper px-2 py-1.5 font-mono text-ink focus:outline-none focus:border-accent">
              {DATE_RANGES.map(dr => <option key={dr.value} value={dr.value}>{dr.label}</option>)}
            </select>
          )}
        </div>
        <main className="flex-1 px-8 py-8">
          {activeTab === 'overview' && summary && <OverviewTab summary={summary} />}
          {activeTab === 'campaigns' && summary && <CampaignsTab campaigns={summary.campaigns || []} />}
          {activeTab === 'keywords' && selectedAccount && <KeywordsTab accountId={selectedAccount} dateRange={dateRange} />}
          {activeTab === 'chat' && (
            <ChatTab messages={chatMessages} input={chatInput} loading={chatLoading} onInputChange={setChatInput}
              onSend={sendChat} accountSelected={!!selectedAccount} onDownload={downloadChat} onUpload={uploadChat} exchangeCount={exchangeCount} />
          )}
          {!summary && !loading && selectedAccount && <div className="flex items-center justify-center h-64"><p className="text-muted font-mono text-sm">Loading account data...</p></div>}
          {!selectedAccount && <div className="flex items-center justify-center h-64"><p className="text-muted font-mono text-sm">Select an account to get started</p></div>}
        </main>
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
