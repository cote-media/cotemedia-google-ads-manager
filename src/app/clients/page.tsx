'use client'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'

type Client = {
  id: string
  name: string
  platform_connections: {
    id: string; platform: string; account_id: string; account_name: string
  }[]
}

type MetaAccount = { id: string; name: string; account_status: number }

type ClientContext = {
  business_type: string
  primary_kpi: string
  funnel_notes: string
  user_notes: string
}

const BUSINESS_TYPES = [
  'E-commerce', 'Lead Generation', 'SaaS / Software', 'Local Service',
  'Brand / Media', 'App / Mobile', 'Non-profit', 'Healthcare', 'Real Estate', 'Other'
]

const PRIMARY_KPIS = [
  'Purchases / ROAS', 'Leads / CPL', 'App Installs / CPI',
  'Reach / CPM', 'Traffic / CPC', 'Video Views / CPV',
  'Engagement', 'Form Submissions', 'Phone Calls', 'Store Visits'
]

const FUNNEL_STAGES = [
  'Full funnel (ToF + MoF + BoF)',
  'Top of funnel only (awareness/reach)',
  'Middle of funnel (consideration/traffic)',
  'Bottom of funnel only (conversions/retargeting)',
  'Retargeting focus',
  'Mixed — varies by campaign'
]

function ClientProfileForm({ client, onSave }: { client: Client; onSave: () => void }) {
  const [context, setContext] = useState<ClientContext>({
    business_type: '', primary_kpi: '', funnel_notes: '', user_notes: ''
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ fileName: string; preview: string; charCount: number; truncated: boolean } | null>(null)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => {
    fetch('/api/context?clientId=' + client.id)
      .then(r => r.json())
      .then(d => {
        if (d.context) {
          setContext({
            business_type: d.context.business_type || '',
            primary_kpi: d.context.primary_kpi || '',
            funnel_notes: d.context.funnel_notes || '',
            user_notes: d.context.user_notes || '',
          })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [client.id])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id, updates: context }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSave()
    } finally { setSaving(false) }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadError(''); setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('clientId', client.id)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const d = await res.json()
      if (d.error) { setUploadError(d.error); return }
      setUploadResult(d)
      // Refresh the notes field to show updated content
      const ctxRes = await fetch('/api/context?clientId=' + client.id)
      const ctxData = await ctxRes.json()
      if (ctxData.context?.user_notes) {
        setContext(p => ({ ...p, user_notes: ctxData.context.user_notes }))
      }
    } catch (err: any) {
      setUploadError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) return <p className="text-xs text-muted font-mono">Loading profile...</p>

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted font-mono">This context is used by Claude for all analyses of this client. The more detail you provide, the more accurate and relevant the insights will be.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Business Type */}
        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">Business Type</label>
          <select value={context.business_type} onChange={e => setContext(p => ({ ...p, business_type: e.target.value }))}
            className="w-full text-sm border border-border bg-paper px-3 py-2 focus:outline-none focus:border-accent rounded-lg">
            <option value="">Select type...</option>
            {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Primary KPI */}
        <div>
          <label className="block text-xs font-medium text-ink mb-1.5">Primary KPI</label>
          <select value={context.primary_kpi} onChange={e => setContext(p => ({ ...p, primary_kpi: e.target.value }))}
            className="w-full text-sm border border-border bg-paper px-3 py-2 focus:outline-none focus:border-accent rounded-lg">
            <option value="">Select KPI...</option>
            {PRIMARY_KPIS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>

      {/* Funnel Stage */}
      <div>
        <label className="block text-xs font-medium text-ink mb-1.5">Funnel Strategy</label>
        <select value={context.funnel_notes} onChange={e => setContext(p => ({ ...p, funnel_notes: e.target.value }))}
          className="w-full text-sm border border-border bg-paper px-3 py-2 focus:outline-none focus:border-accent rounded-lg">
          <option value="">Select funnel approach...</option>
          {FUNNEL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Free-text notes */}
      <div>
        <label className="block text-xs font-medium text-ink mb-1.5">
          Additional Context for Claude
          <span className="text-muted font-normal ml-1">(industry, benchmarks, seasonality, anything Claude should always know)</span>
        </label>
        <textarea value={context.user_notes} onChange={e => setContext(p => ({ ...p, user_notes: e.target.value }))}
          rows={4} placeholder="e.g. This client is a boutique pet food brand targeting dog owners 35+. They run seasonal sales in October. Their target CPA is $45. Don't focus on ROAS for awareness campaigns — they measure those by reach and CPM only."
          className="w-full text-sm border border-border bg-paper px-3 py-2 focus:outline-none focus:border-accent rounded-lg resize-none" />
        <p className="text-xs text-muted mt-1">{context.user_notes.length} characters</p>
      </div>

      {/* Document Upload */}
      <div className="border border-border rounded-xl p-4 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-medium text-ink">Upload Document</p>
            <p className="text-xs text-muted mt-0.5">PDF, DOCX, TXT, or CSV — strategy docs, sales data, brand briefs</p>
          </div>
          <label className={'text-xs font-mono border px-3 py-1.5 rounded-lg cursor-pointer transition-colors ' + (uploading ? 'opacity-50 cursor-not-allowed border-border text-muted' : 'border-accent text-accent hover:bg-accent hover:text-white')}>
            {uploading ? '⏳ Processing...' : '↑ Upload'}
            <input type="file" accept=".pdf,.docx,.txt,.csv" onChange={handleUpload} disabled={uploading} className="hidden" />
          </label>
        </div>
        {uploadError && <p className="text-xs text-red-600 mt-2">{uploadError}</p>}
        {uploadResult && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-xs font-medium text-green-700 mb-1">✓ {uploadResult.fileName} uploaded ({uploadResult.charCount.toLocaleString()} characters{uploadResult.truncated ? ', truncated' : ''})</p>
            <p className="text-xs text-green-600 font-mono">{uploadResult.preview}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
        {saved && <span className="text-xs text-green-600 font-mono">✓ Saved — Claude will use this context for all future analyses</span>}
      </div>
    </div>
  )
}

function ClientsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [googleAccounts, setGoogleAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [shopifyModal, setShopifyModal] = useState<string | null>(null) // clientId
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [shopifySuccess, setShopifySuccess] = useState(false)

  // Meta modal state
  const [metaModal, setMetaModal] = useState<{ clientId: string; accounts: MetaAccount[] } | null>(null)
  const [selectedMetaAccounts, setSelectedMetaAccounts] = useState<string[]>([])
  const [metaError, setMetaError] = useState('')

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])

  useEffect(() => {
    if (session) {
      Promise.all([fetchClients(), fetchGoogleAccounts()]).finally(() => setLoading(false))
    }
  }, [session])

  useEffect(() => {
    const metaAccounts = searchParams.get('meta_accounts')
    const clientId = searchParams.get('client_id')
    const metaErr = searchParams.get('meta_error')
    const shopifyConnected = searchParams.get('shopify_connected')
    const shopifyError = searchParams.get('shopify_error')

    if (metaErr) { setMetaError('Meta connection failed: ' + metaErr); return }
    if (shopifyError) { setMetaError('Shopify connection failed: ' + shopifyError); return }
    if (shopifyConnected === 'true') {
      setShopifySuccess(true)
      fetchClients()
      router.replace('/clients')
      setTimeout(() => setShopifySuccess(false), 4000)
      return
    }
    if (metaAccounts && clientId) {
      try {
        const accounts: MetaAccount[] = JSON.parse(decodeURIComponent(metaAccounts))
        setMetaModal({ clientId, accounts })
        setSelectedMetaAccounts([])
      } catch { setMetaError('Failed to parse Meta accounts') }
    }
  }, [searchParams])

  async function fetchClients() {
    const res = await fetch('/api/clients')
    const data = await res.json()
    setClients(data.clients || [])
  }

  async function fetchGoogleAccounts() {
    const res = await fetch('/api/accounts')
    const data = await res.json()
    const accounts = data.accounts || []
    setGoogleAccounts(accounts)
    const defaults: Record<string, string> = {}
    accounts.forEach((a: any) => { defaults[a.id] = a.name })
    setMappings(defaults)
  }

  async function saveAllMappings() {
    setSaving(true)
    try {
      for (const [accountId, clientName] of Object.entries(mappings)) {
        if (clientName.trim()) {
          const account = googleAccounts.find(a => a.id === accountId)
          const res = await fetch('/api/clients', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: clientName.trim() }),
          })
          const data = await res.json()
          if (data.client) {
            await fetch('/api/clients/connections', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: data.client.id, platform: 'google', account_id: accountId, account_name: account?.name }),
            })
          }
        }
      }
      await fetchClients()
    } finally { setSaving(false) }
  }

  async function saveMetaConnections() {
    if (!metaModal || selectedMetaAccounts.length === 0) return
    setSaving(true)
    try {
      for (const accountId of selectedMetaAccounts) {
        const account = metaModal.accounts.find(a => a.id === accountId)
        await fetch('/api/clients/connections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: metaModal.clientId, platform: 'meta', account_id: accountId, account_name: account?.name || accountId }),
        })
      }
      setMetaModal(null); setSelectedMetaAccounts([])
      await fetchClients()
      router.replace('/clients')
    } finally { setSaving(false) }
  }

  function toggleMetaAccount(id: string) {
    setSelectedMetaAccounts(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id])
  }

  async function disconnectMeta(clientId: string, connectionId: string) {
    await fetch('/api/clients/connections?id=' + connectionId, { method: 'DELETE' })
    await fetchClients()
  }

  const unmappedAccounts = googleAccounts.filter(acc =>
    !clients.some(c => c.platform_connections.some(p => p.account_id === acc.id && p.platform === 'google'))
  )

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="font-mono text-xs text-muted uppercase tracking-widest">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <div className="border-b border-border px-8 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-muted hover:text-ink transition-colors font-mono text-xs">← Dashboard</button>
          <span className="text-border">|</span>
          <span className="font-display text-lg text-ink">Advar</span>
        </div>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Client Manager</span>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        {metaError && (
          <div className="mb-6 bg-red-50 border border-red-300 px-4 py-3 rounded-lg">
            <p className="text-sm text-red-700">{metaError}</p>
            <button onClick={() => setMetaError('')} className="text-xs text-red-500 hover:underline mt-1">Dismiss</button>
          </div>
        )}

        {/* Existing clients */}
        {clients.length > 0 && (
          <div className="mb-12">
            <h2 className="font-display text-2xl text-ink mb-6">Your Clients</h2>
            <div className="space-y-3">
              {clients.map(client => {
                const googleConn = client.platform_connections.find(p => p.platform === 'google')
                const metaConn = client.platform_connections.find(p => p.platform === 'meta')
                const shopifyConn = client.platform_connections.find(p => p.platform === 'shopify')
                const isExpanded = expandedProfile === client.id
                return (
                  <div key={client.id} className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
                    {/* Client header */}
                    <div className="px-6 py-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-ink mb-2">{client.name}</p>
                          <div className="flex flex-wrap gap-2">
                            {googleConn && (
                              <span className="text-xs font-mono text-muted bg-surface px-2 py-1 rounded-full">
                                🔵 Google · {googleConn.account_name}
                              </span>
                            )}
                            {metaConn && (
                              <span className="text-xs font-mono text-muted bg-surface px-2 py-1 rounded-full">
                                🔷 Meta · {metaConn.account_name}
                              </span>
                            )}
                            {shopifyConn && (
                              <span className="text-xs font-mono text-muted bg-surface px-2 py-1 rounded-full">
                                🛍 Shopify · {shopifyConn.account_name}
                              </span>
                            )}
                            {client.platform_connections.length === 0 && (
                              <span className="text-xs font-mono text-muted">No accounts connected</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0 flex-wrap justify-end">
                          {!metaConn && (
                            <a href={'/api/meta/auth?clientId=' + client.id}
                              className="text-xs font-mono text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                              + Meta
                            </a>
                          )}
                          {metaConn && (
                            <button onClick={() => disconnectMeta(client.id, metaConn.id)}
                              className="text-xs font-mono text-red-400 hover:text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                              Disconnect Meta
                            </button>
                          )}
                          {!shopifyConn && (
                            <button onClick={() => { setShopifyModal(client.id); setShopifyDomain('') }}
                              className="text-xs font-mono text-green-600 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
                              + Shopify
                            </button>
                          )}
                          {shopifyConn && (
                            <button onClick={async () => {
                              await fetch('/api/clients/connections?id=' + shopifyConn.id, { method: 'DELETE' })
                              fetchClients()
                            }}
                              className="text-xs font-mono text-red-400 hover:text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                              Disconnect Shopify
                            </button>
                          )}
                          <button onClick={() => setExpandedProfile(isExpanded ? null : client.id)}
                            className={'text-xs font-mono border px-3 py-1.5 rounded-lg transition-colors ' + (isExpanded ? 'bg-accent text-white border-accent' : 'text-muted border-border hover:text-ink')}>
                            {isExpanded ? '↑ Close' : '✦ Claude Profile'}
                          </button>
                          {googleConn && (
                            <button onClick={() => router.push('/dashboard')}
                              className="text-xs font-mono text-accent hover:underline">
                              Open →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Claude profile */}
                    {isExpanded && (
                      <div className="border-t border-border bg-slate-50 px-6 py-5">
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-xs font-mono text-accent uppercase tracking-widest">✦ Claude Client Profile</span>
                          <span className="text-xs text-muted font-mono">— helps Claude give better, more relevant analysis</span>
                        </div>
                        <ClientProfileForm client={client} onSave={() => {}} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Unmapped Google accounts */}
        {unmappedAccounts.length > 0 && (
          <div className="mb-12">
            <h2 className="font-display text-2xl text-ink mb-2">Set Up Clients</h2>
            <p className="text-sm text-muted font-mono mb-6">
              {unmappedAccounts.length} Google Ads account{unmappedAccounts.length > 1 ? 's' : ''} not yet assigned to a client.
            </p>
            <div className="space-y-3 mb-6">
              {unmappedAccounts.map(account => (
                <div key={account.id} className="bg-white border border-border rounded-xl px-6 py-4 flex items-center gap-4 shadow-sm">
                  <div className="flex-1">
                    <p className="text-xs font-mono text-muted mb-1">Google Ads Account</p>
                    <p className="text-sm text-ink">{account.name}</p>
                  </div>
                  <span className="text-muted">→</span>
                  <div className="flex-1">
                    <p className="text-xs font-mono text-muted mb-1">Client Name</p>
                    <input type="text" value={mappings[account.id] ?? account.name}
                      onChange={e => setMappings(prev => ({ ...prev, [account.id]: e.target.value }))}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-paper focus:outline-none focus:border-accent" />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={saveAllMappings} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Clients'}
            </button>
          </div>
        )}

        {/* Add new client */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl text-ink">Add Client Manually</h2>
            <button onClick={() => setShowNewClient(!showNewClient)} className="text-xs font-mono text-accent hover:underline">
              {showNewClient ? 'Cancel' : '+ New client'}
            </button>
          </div>
          {showNewClient && (
            <div className="bg-white border border-border rounded-xl px-6 py-5 shadow-sm">
              <input type="text" value={newClientName} onChange={e => setNewClientName(e.target.value)}
                placeholder="Client name"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-paper focus:outline-none focus:border-accent mb-3" />
              <button onClick={async () => {
                if (!newClientName.trim()) return
                setSaving(true)
                await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newClientName.trim() }) })
                setNewClientName(''); setShowNewClient(false)
                await fetchClients()
                setSaving(false)
              }} disabled={saving || !newClientName.trim()} className="btn-primary disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Client'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Meta account selector modal */}
      {metaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-lg p-8 rounded-2xl shadow-xl">
            <h3 className="font-display text-xl text-ink mb-2">Connect Meta Ad Accounts</h3>
            <p className="text-sm text-muted font-mono mb-6">Select which Meta ad accounts to connect to this client.</p>
            {metaModal.accounts.length === 0 ? (
              <p className="text-sm text-muted font-mono">No ad accounts found.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mb-6">
                {metaModal.accounts.map(account => (
                  <label key={account.id} className="flex items-center gap-3 py-2 px-3 border border-border rounded-lg hover:bg-surface cursor-pointer">
                    <input type="checkbox" checked={selectedMetaAccounts.includes(account.id)}
                      onChange={() => toggleMetaAccount(account.id)} className="accent-accent" />
                    <div>
                      <p className="text-sm text-ink">{account.name}</p>
                      <p className="text-xs font-mono text-muted">{account.id}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={saveMetaConnections} disabled={saving || selectedMetaAccounts.length === 0}
                className="btn-primary disabled:opacity-50">
                {saving ? 'Connecting...' : 'Connect ' + selectedMetaAccounts.length + ' account' + (selectedMetaAccounts.length !== 1 ? 's' : '')}
              </button>
              <button onClick={() => { setMetaModal(null); router.replace('/clients') }}
                className="text-xs font-mono text-muted hover:text-ink border border-border rounded-lg px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shopify connect modal */}
      {shopifyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl">
            <h3 className="font-display text-xl text-ink mb-2">Connect Shopify Store</h3>
            <p className="text-sm text-muted font-mono mb-6">Enter the store's myshopify.com domain to connect.</p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-ink mb-1.5">Store Domain</label>
              <input type="text" value={shopifyDomain} onChange={e => setShopifyDomain(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-accent" />
              <p className="text-xs text-muted mt-1 font-mono">Must end in .myshopify.com</p>
            </div>
            <div className="flex gap-3">
              <a href={shopifyDomain.includes('.myshopify.com') ? `/api/shopify/auth?clientId=${shopifyModal}&shop=${shopifyDomain}` : '#'}
                onClick={e => { if (!shopifyDomain.includes('.myshopify.com')) e.preventDefault() }}
                className={'btn-primary text-center ' + (!shopifyDomain.includes('.myshopify.com') ? 'opacity-50 pointer-events-none' : '')}>
                Connect Shopify
              </a>
              <button onClick={() => setShopifyModal(null)}
                className="text-xs font-mono text-muted hover:text-ink border border-border rounded-lg px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shopify success notification */}
      {shopifySuccess && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-6 py-3 rounded-xl shadow-xl z-50 font-mono text-sm">
          ✓ Shopify connected successfully
        </div>
      )}
    </div>
  )
}

export default function ClientsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center"><p className="font-mono text-xs text-muted">Loading...</p></div>}>
      <ClientsContent />
    </Suspense>
  )
}
