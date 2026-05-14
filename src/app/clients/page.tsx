'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

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

type GoogleAccount = {
  id: string
  name: string
}

export default function ClientsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [mappings, setMappings] = useState<Record<string, string>>({})

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  useEffect(() => {
    if (session) {
      Promise.all([fetchClients(), fetchGoogleAccounts()]).finally(() => setLoading(false))
    }
  }, [session])

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
    // Pre-fill mappings with account names as defaults
    const defaultMappings: Record<string, string> = {}
    accounts.forEach((a: any) => { defaultMappings[a.id] = a.name })
    setMappings(defaultMappings)
  }

  async function createClient(name: string, googleAccountId?: string, googleAccountName?: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (data.client && googleAccountId) {
        await fetch('/api/clients/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: data.client.id,
            platform: 'google',
            account_id: googleAccountId,
            account_name: googleAccountName,
          }),
        })
      }
      await fetchClients()
    } finally {
      setSaving(false)
    }
  }

  async function saveAllMappings() {
    setSaving(true)
    try {
      for (const [accountId, clientName] of Object.entries(mappings)) {
        if (clientName.trim()) {
          const account = googleAccounts.find(a => a.id === accountId)
          await createClient(clientName.trim(), accountId, account?.name)
        }
      }
      setMappings({})
    } finally {
      setSaving(false)
    }
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
      <div className="border-b border-border px-8 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/dashboard')} className="text-muted hover:text-ink transition-colors font-mono text-xs">← Dashboard</button>
          <span className="text-border">|</span>
          <span className="font-display text-lg text-ink">Advar</span>
        </div>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Client Manager</span>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">

        {/* Existing clients */}
        {clients.length > 0 && (
          <div className="mb-12">
            <h2 className="font-display text-2xl text-ink mb-6">Your Clients</h2>
            <div className="space-y-3">
              {clients.map(client => (
                <div key={client.id} className="bg-white border border-border px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-ink">{client.name}</p>
                    <div className="flex gap-3 mt-1">
                      {client.platform_connections.map(conn => (
                        <span key={conn.id} className="text-xs font-mono text-muted">
                          {conn.platform === 'google' ? '🔵' : '🔷'} {conn.account_name}
                        </span>
                      ))}
                      {client.platform_connections.length === 0 && (
                        <span className="text-xs font-mono text-muted">No accounts connected</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/dashboard?account=' + (client.platform_connections.find(p => p.platform === 'google')?.account_id || ''))}
                    className="text-xs font-mono text-accent hover:underline"
                  >
                    Open →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unmapped Google accounts */}
        {unmappedAccounts.length > 0 && (
          <div className="mb-12">
            <h2 className="font-display text-2xl text-ink mb-2">Set Up Clients</h2>
            <p className="text-sm text-muted font-mono mb-6">
              You have {unmappedAccounts.length} Google Ads account{unmappedAccounts.length > 1 ? 's' : ''} not yet assigned to a client.
              Give each one a client name — it can be the same as the account name.
            </p>
            <div className="space-y-3 mb-6">
              {unmappedAccounts.map(account => (
                <div key={account.id} className="bg-white border border-border px-6 py-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-xs font-mono text-muted mb-1">Google Ads Account</p>
                    <p className="text-sm text-ink">{account.name}</p>
                  </div>
                  <span className="text-muted">→</span>
                  <div className="flex-1">
                    <p className="text-xs font-mono text-muted mb-1">Client Name</p>
                    <input
                      type="text"
                      value={mappings[account.id] ?? account.name}
                      onChange={e => setMappings(prev => ({ ...prev, [account.id]: e.target.value }))}
                      className="w-full border border-border px-3 py-1.5 text-sm bg-paper focus:outline-none focus:border-accent font-sans"
                      placeholder={account.name}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={saveAllMappings}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Clients'}
            </button>
          </div>
        )}

        {/* Add new client manually */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl text-ink">Add Client Manually</h2>
            <button onClick={() => setShowNewClient(!showNewClient)} className="text-xs font-mono text-accent hover:underline">
              {showNewClient ? 'Cancel' : '+ New client'}
            </button>
          </div>
          {showNewClient && (
            <div className="bg-white border border-border px-6 py-5">
              <input
                type="text"
                value={newClientName}
                onChange={e => setNewClientName(e.target.value)}
                placeholder="Client name"
                className="w-full border border-border px-3 py-2 text-sm bg-paper focus:outline-none focus:border-accent font-sans mb-3"
              />
              <button
                onClick={() => { if (newClientName.trim()) { createClient(newClientName.trim()); setNewClientName(''); setShowNewClient(false) } }}
                disabled={saving || !newClientName.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create Client'}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
