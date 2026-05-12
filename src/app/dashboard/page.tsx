'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function DashboardContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<any[]>([])

  // Restore from URL on load
  useEffect(() => {
    const acc = searchParams.get('account')
    const dr = searchParams.get('range')
    const tab = searchParams.get('tab')
    if (acc) setSelectedAccount(acc)
    if (dr) setDateRange(dr)
    if (tab) setActiveTab(tab as any)
  }, [])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<string>('LAST_30_DAYS')
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [sessionStart, setSessionStart] = useState(0)
  const [activeTab, setActiveTab] = useState<'overview' | 'campaigns' | 'keywords' | 'chat'>('overview')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  useEffect(() => {
    if (session) fetchAccounts()
  }, [session])

  useEffect(() => {
    if (selectedAccount) {
      fetchSummary(selectedAccount)
      const params = new URLSearchParams()
      params.set('account', selectedAccount)
      params.set('range', dateRange)
      router.replace('/dashboard?' + params.toString(), { scroll: false })
    }
  }, [selectedAccount, dateRange])

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
      const urlAccount = new URLSearchParams(window.location.search).get('account')
      if (data.accounts?.length > 0 && !urlAccount) setSelectedAccount(data.accounts[0].id)
      else if (urlAccount) setSelectedAccount(urlAccount)
    } catch (e) {
      console.error(e)
    }
  }

  async function fetchSummary(accountId: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns?accountId=${accountId}`)
      const data = await res.json()
      setSummary(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || !selectedAccount) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }]
    setChatMessages(newMessages)
    setChatLoading(true)
    const history = newMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
    const accountName = accounts.find((a) => a.id === selectedAccount)?.name || selectedAccount
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, accountId: selectedAccount, summary, dateRange, history: history.slice(0, -1), accountName }),
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      setTimeout(() => { const el = document.getElementById('chat-messages'); if (el) el.scrollTop = el.scrollHeight }, 100)
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setChatLoading(false)
    }
  }

  function downloadChat() {
    const accountName = accounts.find((a) => a.id === selectedAccount)?.name || selectedAccount
    const text = chatMessages.map(m => (m.role === 'user' ? 'You' : 'Claude') + ': ' + m.content).join('\n\n---\n\n')
    const header = 'CMAM Chat Export\nAccount: ' + accountName + '\nDate: ' + new Date().toLocaleDateString() + '\n\n'
    const blob = new Blob([header + text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cmam-' + accountName.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '-' + new Date().toISOString().split('T')[0] + '.txt'
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
      const lines = text.split('\n\n---\n\n')
      const messages = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('You: ')) {
          messages.push({ role: 'user', content: trimmed.slice(5) })
        } else if (trimmed.startsWith('Claude: ')) {
          messages.push({ role: 'assistant', content: trimmed.slice(8) })
        }
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

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-8 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-6">
          <span className="font-display text-lg text-ink">Cote Media</span>
          <span className="text-border">|</span>
          <span className="font-mono text-xs tracking-widest uppercase text-muted">Ads Manager</span>
        </div>
        <div className="flex items-center gap-4">
          {accounts.length > 0 && (
            <select
              value={selectedAccount || ''}
              onChange={e => setSelectedAccount(e.target.value)}
              className="text-sm border border-border bg-paper px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-ink"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
              ))}
            </select>
          )}
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="text-sm border border-border bg-paper px-3 py-1.5 font-mono text-xs text-ink focus:outline-none focus:border-ink"
          >
            <option value="LAST_7_DAYS">Last 7 days</option>
            <option value="LAST_14_DAYS">Last 14 days</option>
            <option value="LAST_30_DAYS">Last 30 days</option>
            <option value="THIS_MONTH">This month</option>
            <option value="LAST_MONTH">Last month</option>
            <option value="LAST_90_DAYS">Last 90 days</option>
          </select>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-xs font-mono text-muted hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="border-b border-border bg-white px-8">
        <div className="flex gap-0">
          {(['overview', 'campaigns', 'keywords', 'chat'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); const p = new URLSearchParams(window.location.search); p.set('tab', tab); window.history.replaceState(null, '', '/dashboard?' + p.toString()) }}
              className={`px-5 py-3 text-xs font-mono uppercase tracking-widest border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">
        {loading && (
          <div className="flex items-center gap-2 text-muted text-sm font-mono mb-6">
            <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            Loading account data...
          </div>
        )}

        {activeTab === 'overview' && summary && (
          <OverviewTab summary={summary} />
        )}

        {activeTab === 'campaigns' && summary && (
          <CampaignsTab campaigns={summary.campaigns || []} />
        )}

        {activeTab === 'keywords' && selectedAccount && (
          <KeywordsTab accountId={selectedAccount} />
        )}

        {activeTab === 'chat' && (
          <ChatTab
            messages={chatMessages}
            input={chatInput}
            loading={chatLoading}
            onInputChange={setChatInput}
            onSend={sendChat}
            accountSelected={!!selectedAccount}
            onDownload={downloadChat}
            onUpload={uploadChat}
            exchangeCount={Math.floor((chatMessages.length - sessionStart) / 2)}
          />
        )}

        {!summary && !loading && (
          <EmptyState />
        )}
      </main>
    </div>
  )
}

function OverviewTab({ summary }: { summary: any }) {
  const metrics = [
    { label: 'Total Spend', value: `$${Number(summary.totalCost).toLocaleString()}` },
    { label: 'Clicks', value: Number(summary.totalClicks).toLocaleString() },
    { label: 'Impressions', value: Number(summary.totalImpressions).toLocaleString() },
    { label: 'Conversions', value: summary.totalConversions },
    { label: 'ROAS', value: `${summary.roas}x` },
    { label: 'Avg CTR', value: `${summary.avgCtr}%` },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-ink mb-1">Account Overview</h2>
        <p className="text-sm text-muted font-mono">Last 30 days · {summary.activeCampaigns} active campaigns</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border mb-8">
        {metrics.map(m => (
          <div key={m.label} className="bg-white p-5">
            <div className="metric-label mb-2">{m.label}</div>
            <div className="metric-value">{m.value}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-mono text-xs tracking-widest uppercase text-muted mb-4">Top Campaigns by Spend</h3>
        <div className="bg-white border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Campaign</th>
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Spend</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Clicks</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">CTR</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {(summary.campaigns || []).slice(0, 10).map((c: any) => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-3 text-ink font-medium max-w-xs truncate">{c.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">${Number(c.cost).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{Number(c.clicks).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{c.ctr}%</td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                    {c.roas ? `${c.roas}x` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CampaignsTab({ campaigns }: { campaigns: any[] }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-ink mb-1">Campaigns</h2>
        <p className="text-sm text-muted font-mono">{campaigns.length} campaigns · Last 30 days</p>
      </div>
      <div className="bg-white border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Campaign</th>
              
              <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Status</th>
              <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Budget/day</th>
              <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Spend</th>
              <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Clicks</th>
              <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Conv.</th>
              <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c: any) => (
              <tr key={c.id} className="table-row">
                <td className="px-4 py-3 font-medium max-w-xs truncate">{c.name}</td>

                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-right font-mono text-sm">{c.budget ? `$${c.budget}` : '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-sm">${Number(c.cost).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{Number(c.clicks).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{Number(c.conversions).toFixed(1)}</td>
                <td className="px-4 py-3 text-right font-mono text-sm font-medium">{c.roas ? `${c.roas}x` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KeywordsTab({ accountId }: { accountId: string }) {
  const [keywords, setKeywords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/keywords?accountId=${accountId}`)
      .then(r => r.json())
      .then(d => { setKeywords(d.keywords || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [accountId])

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-ink mb-1">Keywords</h2>
        <p className="text-sm text-muted font-mono">Top 200 by spend · Last 30 days</p>
      </div>
      {loading ? (
        <div className="text-muted text-sm font-mono">Loading keywords...</div>
      ) : (
        <div className="bg-white border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Keyword</th>
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Match</th>
                <th className="text-left px-4 py-3 font-mono text-xs text-muted tracking-wider">Campaign</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Spend</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">Clicks</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">CTR</th>
                <th className="text-right px-4 py-3 font-mono text-xs text-muted tracking-wider">QS</th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((k: any, i: number) => (
                <tr key={i} className="table-row">
                  <td className="px-4 py-3 font-medium">{k.text}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted">{k.matchType === "4" || k.matchType === "BROAD" ? "Broad" : k.matchType === "3" || k.matchType === "PHRASE" ? "Phrase" : k.matchType === "2" || k.matchType === "EXACT" ? "Exact" : k.matchType}</td>
                  <td className="px-4 py-3 text-xs text-muted truncate max-w-xs">{k.campaign}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">${k.cost}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{k.clicks}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{k.ctr}%</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {k.qualityScore ? (
                      <span className={k.qualityScore >= 7 ? 'text-green-600' : k.qualityScore >= 4 ? 'text-amber-600' : 'text-red-600'}>
                        {k.qualityScore}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ChatTab({ messages, input, loading, onInputChange, onSend, accountSelected, onDownload, onUpload, exchangeCount }: any) {
  return (
    <div className="max-w-5xl">
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
          {messages.length > 0 && <button onClick={onDownload} className="text-xs font-mono text-muted hover:text-ink border border-border px-3 py-1.5 transition-colors">↓ Save chat</button>}
        </div>
      </div>
      {exchangeCount % 4 === 3 && exchangeCount > 0 && messages.length > 0 && (
        <div className="mb-4 bg-red-50 border-2 border-red-400 px-4 py-3">
          <p className="text-sm text-red-700 font-semibold">⚠️ 1 exchange remaining. <button onClick={onDownload} className="underline font-bold">Save transcript</button> now so you can continue this analysis.</p>
        </div>
      )}
      {exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0 && (
        <div className="mb-4 bg-ink border-2 border-ink px-6 py-5 text-center">
          <p className="text-paper font-semibold mb-1">You've used all 4 exchanges.</p>
          <p className="text-paper text-sm mb-4 opacity-80">Download your transcript, then re-upload it to start a fresh 4-pack with full context.</p>
          <button onClick={onDownload} className="bg-paper text-ink text-sm font-mono px-5 py-2 hover:bg-surface transition-colors">↓ Download transcript</button>
        </div>
      )}

      <div className="bg-white border border-border min-h-96 flex flex-col">
        <div id="chat-messages" className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[500px]">
          {messages.length === 0 && (
            <div className="text-muted text-sm font-mono space-y-2">
              <p>Try asking:</p>
              <p className="text-ink">"Which campaigns have the best ROAS?"</p>
              <p className="text-ink">"What keywords are wasting budget?"</p>
              <p className="text-ink">"Summarize this account's performance"</p>
            </div>
          )}
          {messages.map((m: any, i: number) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-ink text-paper'
              }`}>: 'bg-surface text-ink border border-border chat-response'
                {m.content}
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
            onKeyDown={e => e.key === 'Enter' && onSend()}
            placeholder={accountSelected ? "Ask about this account..." : "Select an account first"}
            disabled={!accountSelected || (exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0)}
            className="flex-1 border border-border px-4 py-2.5 text-sm bg-paper focus:outline-none focus:border-ink font-sans disabled:opacity-50"
          />
          <button
            onClick={onSend}
            disabled={!accountSelected || loading || (exchangeCount > 0 && exchangeCount % 4 === 0 && messages.length > 0)}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ENABLED' || status === '2') return <span className="badge-good">● Active</span>
  if (status === 'PAUSED' || status === '3') return <span className="badge-warn">● Paused</span>
  if (status === 'REMOVED' || status === '4') return <span className="badge-bad">● Removed</span>
  return <span className="badge-bad">● {status}</span>
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

function EmptyState() {
  return (
    <div className="text-center py-24">
      <p className="font-display text-2xl text-ink mb-2">No data yet</p>
      <p className="text-sm text-muted font-mono">Select an account to load campaign data</p>
    </div>
  )
}

const CAMPAIGN_TYPES: Record<string, string> = {
  '2': 'Search', '3': 'Display', '4': 'Shopping', '6': 'Video',
  '9': 'Smart', '10': 'Performance Max', '11': 'Discovery',
  'SEARCH': 'Search', 'DISPLAY': 'Display', 'SHOPPING': 'Shopping',
  'VIDEO': 'Video', 'SMART': 'Smart', 'PERFORMANCE_MAX': 'Performance Max',
}

const CAMPAIGN_STATUSES: Record<string, string> = {
  '2': 'Active', '3': 'Paused', '4': 'Removed',
  'ENABLED': 'Active', 'PAUSED': 'Paused', 'REMOVED': 'Removed',
}

export default function Dashboard() {
  return <Suspense fallback={<div>Loading...</div>}><DashboardContent /></Suspense>
}
