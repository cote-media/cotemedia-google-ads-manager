'use client'
import { useSession, signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import BackfillControl from './BackfillControl'

// LORAMER_CONNECTION_HEALTH_V1 — single flag gates ALL dead-state UI. OFF → byte-identical to
// today (healthy AND dead connections both render exactly as before).
const HEALTH_UI = process.env.NEXT_PUBLIC_SHOW_CONNECTION_HEALTH_UI === '1'

type Client = {
  id: string
  name: string
  platform_connections: {
    id: string; platform: string; account_id: string; account_name: string
    health?: string | null  // LORAMER_CONNECTION_HEALTH_V1 — 'healthy' | 'reconnect' | 'disconnected' | null
    last_error_code?: string | null
  }[]
}

// LORAMER_CONNECTION_HEALTH_V1 — the dead-state affordance: "Reconnect needed" + a Reconnect
// action. Rendered ONLY when HEALTH_UI && health==='reconnect'. scopeNote warns when one
// reconnect heals a whole shared credential (Google MCC OAuth, Meta FB token).
function ReconnectControl({ onClick, href, scopeNote }: { onClick?: () => void; href?: string; scopeNote?: string }) {
  const btnCls = 'text-xs font-sans font-medium text-white rounded px-2 py-0.5 transition-colors'
  const btnStyle = { background: '#D97706' }
  return (
    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
      <span className="text-xs font-sans font-medium" style={{ color: '#B45309' }} title={scopeNote}>Reconnect needed</span>
      {href ? (
        <a href={href} className={btnCls} style={btnStyle} title={scopeNote} onClick={(e) => e.stopPropagation()}>Reconnect</a>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); onClick?.() }} className={btnCls} style={btnStyle} title={scopeNote}>Reconnect</button>
      )}
    </div>
  )
}

type MetaAccount = { id: string; name: string; account_status: number }

// LORAMER_GA_PROPERTY_PICKER_V1
type GaProperty = {
  account_id: string
  account_name: string
  property_id: string
  property_name: string
}

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
      <p className="text-xs text-muted font-mono">This context is used by Lora for all analyses of this client. The more detail you provide, the more accurate and relevant the insights will be.</p>

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
          Additional Context for Lora
          <span className="text-muted font-normal ml-1">(industry, benchmarks, seasonality, anything Lora should always know)</span>
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
        {saved && <span className="text-xs text-green-600 font-mono">✓ Saved — Lora will use this context for all future analyses</span>}
      </div>
      {/* LORAMER_MEMORY_V1_UI */}
      <ClientMemorySection clientId={client.id} />
    </div>
  )
}

// LORAMER_MEMORY_V1_UI
// Memory editor: structured facts Claude knows about this client.
// Categories: directive | fact | observation | preference | context.
// Soft delete (archive) only — facts never hard-deleted (brand commitment).
type MemoryFact = {
  id: number
  content: string
  category: 'directive' | 'fact' | 'observation' | 'preference' | 'context'
  confidence: number
  pinned: boolean
  source: string
  created_at?: string
  updated_at?: string
}

const MEMORY_CATEGORIES: Array<{
  key: MemoryFact['category']
  label: string
  blurb: string
}> = [
  { key: 'directive', label: 'Directives', blurb: 'Binding rules. Lora treats these as hard constraints.' },
  { key: 'fact',      label: 'Facts',      blurb: 'Durable truths about the business.' },
  { key: 'context',   label: 'Context',    blurb: 'Background that helps Lora reason about this client.' },
  { key: 'preference',label: 'Preferences',blurb: 'How you want Lora to respond.' },
  { key: 'observation',label: 'Observations', blurb: 'Patterns Lora has noted. Confirm to promote to a Fact.' },
]

// LORAMER_MEMORY_BOOTSTRAP_V1
type BootstrapCandidate = {
  content: string
  category: 'directive' | 'fact' | 'context' | 'preference'
  source_description: string
  confidence: number
  // UI-only fields:
  selected: boolean
  edited: string
}

function ClientMemorySection({ clientId }: { clientId: string }) {
  const [memory, setMemory] = useState<MemoryFact[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryFact['category']>('fact')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  // LORAMER_MEMORY_BOOTSTRAP_V1
  const [candidates, setCandidates] = useState<BootstrapCandidate[]>([])
  const [showReview, setShowReview] = useState(false)
  const [bootstrapDismissed, setBootstrapDismissed] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  async function reload() {
    setLoading(true)
    try {
      const r = await fetch('/api/memory?clientId=' + clientId)
      const d = await r.json()
      setMemory(d.memory || [])
    } catch {} finally { setLoading(false) }
  }
  // LORAMER_MEMORY_BOOTSTRAP_V1
  async function loadCandidates() {
    try {
      const r = await fetch('/api/memory/bootstrap?clientId=' + clientId)
      const d = await r.json()
      const fetched: any[] = d.candidates || []
      setCandidates(fetched.map(c => ({
        content: c.content,
        category: c.category,
        source_description: c.source_description,
        confidence: c.confidence,
        selected: true,
        edited: c.content,
      })))
    } catch {}
  }
  useEffect(() => { if (clientId) reload() }, [clientId])
  useEffect(() => { if (clientId) loadCandidates() }, [clientId])
  async function importSelected() {
    const toImport = candidates
      .filter(c => c.selected && c.edited.trim().length > 0)
      .map(c => ({ content: c.edited.trim(), category: c.category, confidence: c.confidence }))
    if (toImport.length === 0) {
      setShowReview(false)
      setCandidates([])
      return
    }
    setBootstrapping(true)
    try {
      await fetch('/api/memory/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, candidates: toImport }),
      })
      setShowReview(false)
      setCandidates([])
      await reload()
    } catch {} finally { setBootstrapping(false) }
  }

  async function addFact() {
    const content = newContent.trim()
    if (!content) return
    setSaving(true)
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, content, category: newCategory }),
      })
      setNewContent('')
      setNewCategory('fact')
      setAdding(false)
      await reload()
    } catch {} finally { setSaving(false) }
  }

  async function saveEdit(id: number) {
    const content = editContent.trim()
    if (!content) return
    setSaving(true)
    try {
      await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content }),
      })
      setEditingId(null)
      setEditContent('')
      await reload()
    } catch {} finally { setSaving(false) }
  }

  async function togglePin(fact: MemoryFact) {
    setSaving(true)
    try {
      await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fact.id, pinned: !fact.pinned }),
      })
      await reload()
    } catch {} finally { setSaving(false) }
  }

  async function archiveFact(id: number) {
    if (!confirm('Archive this memory? Lora will no longer reference it. (It stays in the database for audit.)')) return
    setSaving(true)
    try {
      await fetch('/api/memory?id=' + id, { method: 'DELETE' })
      await reload()
    } catch {} finally { setSaving(false) }
  }

  async function changeCategory(id: number, category: MemoryFact['category']) {
    setSaving(true)
    try {
      await fetch('/api/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, category }),
      })
      await reload()
    } catch {} finally { setSaving(false) }
  }

  const grouped = MEMORY_CATEGORIES.map(c => ({
    ...c,
    items: memory.filter(m => m.category === c.key),
  })).filter(g => g.items.length > 0)

  // LORAMER_MEMORY_BOOTSTRAP_V1
  const hasCandidates = candidates.length > 0 && !bootstrapDismissed

  return (
    <div className="border border-border rounded-xl p-4 bg-white mt-4">
      {/* LORAMER_MEMORY_BOOTSTRAP_V1 - banner shown when candidates from notes/chats are available */}
      {hasCandidates && !showReview && (
        <div className="flex items-start gap-3 border border-accent/30 bg-accent/5 rounded-lg p-3 mb-3">
          <span className="text-base shrink-0">💡</span>
          <div className="flex-1">
            <p className="text-sm text-ink">
              Found <span className="font-medium">{candidates.length}</span> potential {candidates.length === 1 ? 'fact' : 'facts'} in this client's existing context.
            </p>
            <p className="text-xs text-muted mt-0.5">Review and add to memory? Existing notes stay intact either way.</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setShowReview(true)}
              className="text-xs font-mono bg-accent text-white px-3 py-1 rounded-lg hover:opacity-90"
            >
              Review
            </button>
            <button
              onClick={() => setBootstrapDismissed(true)}
              className="text-xs font-mono text-muted hover:text-ink px-2 py-1"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* LORAMER_MEMORY_BOOTSTRAP_V1 - review modal (inline expansion) */}
      {showReview && (
        <div className="border border-accent/40 bg-accent/5 rounded-lg p-3 mb-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Review proposed memory facts</p>
              <p className="text-xs text-muted mt-0.5">Uncheck anything you don't want, edit text inline, then save.</p>
            </div>
            <button
              onClick={() => setShowReview(false)}
              className="text-xs font-mono text-muted hover:text-ink"
            >
              × Close
            </button>
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {candidates.map((c, i) => (
              <div key={i} className="flex items-start gap-2 bg-white border border-border rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={c.selected}
                  onChange={() => setCandidates(prev => prev.map((p, j) => j === i ? { ...p, selected: !p.selected } : p))}
                  className="mt-1 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <textarea
                    value={c.edited}
                    onChange={e => setCandidates(prev => prev.map((p, j) => j === i ? { ...p, edited: e.target.value } : p))}
                    className="w-full text-sm font-sans border border-border rounded px-2 py-1 min-h-[40px]"
                    disabled={!c.selected}
                  />
                  <div className="flex items-center gap-2 mt-1">
                    <select
                      value={c.category}
                      onChange={e => setCandidates(prev => prev.map((p, j) => j === i ? { ...p, category: e.target.value as BootstrapCandidate['category'] } : p))}
                      className="text-xs font-mono border border-border rounded px-1.5 py-0.5"
                      disabled={!c.selected}
                    >
                      <option value="directive">Directive</option>
                      <option value="fact">Fact</option>
                      <option value="context">Context</option>
                      <option value="preference">Preference</option>
                    </select>
                    <span className="text-xs text-muted/80 font-mono">{c.source_description}</span>
                    {c.confidence < 1.0 && (
                      <span className="text-xs text-muted/60 font-mono">· confidence {Math.round(c.confidence * 100)}%</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCandidates(prev => prev.map(p => ({ ...p, selected: true })))}
                className="text-xs font-mono text-muted hover:text-ink"
              >
                Select all
              </button>
              <span className="text-xs text-muted/40">·</span>
              <button
                onClick={() => setCandidates(prev => prev.map(p => ({ ...p, selected: false })))}
                className="text-xs font-mono text-muted hover:text-ink"
              >
                Deselect all
              </button>
            </div>
            <button
              onClick={importSelected}
              disabled={bootstrapping || candidates.filter(c => c.selected).length === 0}
              className="text-xs font-mono bg-accent text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {bootstrapping ? 'Importing...' : `Add ${candidates.filter(c => c.selected).length} to memory`}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-ink">What Lora knows about this client</p>
          <p className="text-xs text-muted mt-0.5">
            Structured facts Lora treats as durable knowledge. Edit anytime — Lora uses the latest on every response.
          </p>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-xs font-mono border border-accent text-accent hover:bg-accent hover:text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {adding ? '× Cancel' : '+ Add a fact'}
        </button>
      </div>

      {adding && (
        <div className="border border-accent/30 bg-accent/5 rounded-lg p-3 mb-4 space-y-2">
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="e.g. 'Ignore ROAS — no purchase tracking on this site' or 'Primary KPI is CPL, target $35'"
            className="w-full text-sm font-sans border border-border rounded-lg px-3 py-2 min-h-[60px]"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as MemoryFact['category'])}
              className="text-xs font-mono border border-border rounded-lg px-2 py-1"
            >
              {MEMORY_CATEGORIES.filter(c => c.key !== 'observation').map(c => (
                <option key={c.key} value={c.key}>{c.label.replace(/s$/, '')}</option>
              ))}
            </select>
            <button
              onClick={addFact}
              disabled={saving || !newContent.trim()}
              className="text-xs font-mono bg-accent text-white px-3 py-1 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <span className="text-xs text-muted">
              {MEMORY_CATEGORIES.find(c => c.key === newCategory)?.blurb}
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted font-mono">Loading memory...</p>
      ) : memory.length === 0 ? (
        <p className="text-xs text-muted">
          No memory yet. Add a fact, or tell Lora something in any chat surface (e.g. "remember that...") — durable knowledge will accumulate here.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.key}>
              {/* LORAMER_MEMORY_CATEGORY_BLURB_V1 */}
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {group.label} <span className="text-muted/60">({group.items.length})</span>
              </p>
              <p className="text-xs text-muted/70 mb-1.5">{group.blurb}</p>
              <div className="space-y-1.5">
                {group.items.map(fact => (
                  <div
                    key={fact.id}
                    className="flex items-start gap-2 border border-border rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <button
                      onClick={() => togglePin(fact)}
                      title={fact.pinned ? 'Unpin' : 'Pin (always include in Lora prompts)'}
                      className={'text-base transition-opacity ' + (fact.pinned ? 'opacity-100' : 'opacity-30 hover:opacity-70')}
                    >
                      📌
                    </button>
                    <div className="flex-1 min-w-0">
                      {editingId === fact.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full text-sm font-sans border border-border rounded px-2 py-1 min-h-[50px]"
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveEdit(fact.id)}
                              disabled={saving}
                              className="text-xs font-mono bg-accent text-white px-2 py-0.5 rounded disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditContent('') }}
                              className="text-xs font-mono text-muted hover:text-ink"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-ink">{fact.content}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted/80 font-mono">
                            <span>{fact.source === 'user_explicit' ? 'added by you' : fact.source}</span>
                            {fact.confidence < 1.0 && <span>· confidence {Math.round(fact.confidence * 100)}%</span>}
                          </div>
                        </>
                      )}
                    </div>
                    {editingId !== fact.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          value={fact.category}
                          onChange={e => changeCategory(fact.id, e.target.value as MemoryFact['category'])}
                          className="text-xs font-mono border border-border rounded px-1.5 py-0.5"
                          title="Change category"
                        >
                          {MEMORY_CATEGORIES.map(c => (
                            <option key={c.key} value={c.key}>{c.label.replace(/s$/, '')}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { setEditingId(fact.id); setEditContent(fact.content) }}
                          className="text-xs font-mono text-muted hover:text-accent px-1"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => archiveFact(fact.id)}
                          className="text-xs font-mono text-muted hover:text-red-500 px-1"
                          title="Archive (Lora stops referencing; row preserved in DB)"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// LORAMER_CLIENTS_GRID_V1 - card stat formatting helpers
function fmtCardCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function lastActiveLabel(lastActive: string | null | undefined): string {
  if (!lastActive) return 'No activity yet'
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((todayUtc - new Date(lastActive + 'T00:00:00Z').getTime()) / 86400000)
  if (days <= 0) return 'Active today'
  return 'Active ' + days + 'd ago'
}

function ClientsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  // LORAMER_CLIENTS_GRID_V1 - the deep-surface pill label (one place to change)
  const DEEP_LABEL = 'Mer'

  const [clients, setClients] = useState<Client[]>([])
  const [clientMetrics, setClientMetrics] = useState<Record<string, any>>({})  // LORAMER_CLIENTS_GRID_V1
  const [sortBy, setSortBy] = useState<'alpha' | 'recent' | 'spend' | 'revenue'>('alpha')  // LORAMER_CLIENTS_GRID_V1
  const [googleAccounts, setGoogleAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [shopifyModal, setShopifyModal] = useState<string | null>(null) // clientId
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [profiledClientIds, setProfiledClientIds] = useState<Set<string>>(new Set())
  const [shopifySuccess, setShopifySuccess] = useState(false)
  // LORAMER_WOO_CONNECT_V1
  const [wooModal, setWooModal] = useState<string | null>(null) // clientId
  const [wooDomain, setWooDomain] = useState('')
  const [wooSuccess, setWooSuccess] = useState(false)

  // LORAMER_GA_PROPERTY_PICKER_V1
  const [gaPicker, setGaPicker] = useState<{ loading: boolean; properties: GaProperty[]; error: string } | null>(null)
  const [gaSearch, setGaSearch] = useState('')
  const [gaConnecting, setGaConnecting] = useState(false)
  const [gaSuccess, setGaSuccess] = useState(false)

  // Meta modal state
  const [metaModal, setMetaModal] = useState<{ clientId: string; accounts: MetaAccount[] } | null>(null)
  const [selectedMetaAccounts, setSelectedMetaAccounts] = useState<string[]>([])
  const [metaError, setMetaError] = useState('')

  // LORAMER_GOOGLE_PILL_CONNECT_V1 — per-client Google Ads account picker (clientId or null)
  const [googleModal, setGoogleModal] = useState<string | null>(null)

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])

  // LORAMER_CLIENTS_GRID_V1 - Escape closes the Mer overlay
  useEffect(() => {
    if (!expandedProfile) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedProfile(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedProfile])

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
    // LORAMER_WOO_CONNECT_V1 - WooCommerce return params
    const wooConnected = searchParams.get('woo_connected')
    const wooErr = searchParams.get('woo_error')
    if (wooErr) { setMetaError('WooCommerce connection failed: ' + wooErr); return }
    if (wooConnected) {
      setWooSuccess(true)
      fetchClients()
      router.replace('/clients')
      setTimeout(() => setWooSuccess(false), 4000)
      return
    }
    // LORAMER_GA_PROPERTY_PICKER_V1
    const gaOauth = searchParams.get('ga_oauth')
    if (gaOauth === 'success') { openGaPicker(); router.replace('/clients'); return }
    if (gaOauth === 'denied') { setMetaError('Google Analytics connection was cancelled.'); return }
    if (gaOauth === 'error') { setMetaError('Google Analytics connection failed. Please try again.'); return }

    if (metaAccounts && clientId) {
      try {
        const accounts: MetaAccount[] = JSON.parse(decodeURIComponent(metaAccounts))
        setMetaModal({ clientId, accounts })
        setSelectedMetaAccounts([])
      } catch { setMetaError('Failed to parse Meta accounts') }
    }
  }, [searchParams])

  // LORAMER_PILL_ROUTING_V1
  function goToDashboard(client: Client, platform?: 'google' | 'meta') {  // LORAMER_PILL_ROUTING_V2
    try {
      localStorage.setItem('advar-active-client', client.id)
      if (platform) localStorage.setItem('advar-active-platform', platform)
    } catch {}
    router.push('/dashboard')
  }

  async function fetchClients() {
    const res = await fetch('/api/clients')
    fetch('/api/clients/profiles').then(r => r.json()).then(d => {
      setProfiledClientIds(new Set<string>(d.profiledClientIds || []))
    }).catch(() => {})
    // LORAMER_CLIENTS_GRID_V1 - hydrate per-client stat cards from the rollup endpoint
    fetch('/api/clients/metrics').then(r => r.json()).then(d => {
      setClientMetrics(d.metrics || {})
    }).catch(() => {})
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

  // LORAMER_GOOGLE_PILL_CONNECT_V1 — attach one accessible Google Ads account to this client.
  // Mirrors saveMetaConnections (same POST shape) but single-select: a client maps to one
  // Google Ads account (googleConn is a single find).
  async function connectGoogleAccount(clientId: string, account: any) {
    setSaving(true)
    try {
      await fetch('/api/clients/connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, platform: 'google', account_id: account.id, account_name: account.name }),
      })
      setGoogleModal(null)
      await fetchClients()
    } finally { setSaving(false) }
  }

  // LORAMER_GA_PROPERTY_PICKER_V1
  async function openGaPicker() {
    setGaSearch('')
    setGaPicker({ loading: true, properties: [], error: '' })
    try {
      const r = await fetch('/api/ga/properties')
      const d = await r.json()
      if (d.error) { setGaPicker({ loading: false, properties: [], error: d.error }); return }
      setGaPicker({ loading: false, properties: d.properties || [], error: '' })
    } catch {
      setGaPicker({ loading: false, properties: [], error: 'Could not load Google Analytics properties.' })
    }
  }

  async function connectGaProperty(p: GaProperty) {
    setGaConnecting(true)
    try {
      const r = await fetch('/api/ga/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: p.property_id,
          property_name: p.property_name,
          account_id: p.account_id,
          account_name: p.account_name,
        }),
      })
      const d = await r.json()
      if (d.error) { setGaPicker(prev => prev ? { ...prev, error: d.error } : prev); return }
      setGaPicker(null)
      setGaSuccess(true)
      await fetchClients()
      setTimeout(() => setGaSuccess(false), 4000)
    } catch {
      setGaPicker(prev => prev ? { ...prev, error: 'Connection failed. Please try again.' } : prev)
    } finally {
      setGaConnecting(false)
    }
  }

  const unmappedAccounts = googleAccounts.filter(acc =>
    !clients.some(c => c.platform_connections.some(p => p.account_id === acc.id && p.platform === 'google'))
  )

  // LORAMER_CLIENTS_GRID_V1 - derived render order. Metrics-based sorts use the
  // hydrated rollup; missing values sort last; ties (and pre-hydration) fall
  // back to the alphabetical order.
  const sortedClients = [...clients].sort((a, b) => {
    const alpha = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    if (sortBy === 'recent') {
      const la = clientMetrics[a.id]?.lastActive || ''
      const lb = clientMetrics[b.id]?.lastActive || ''
      if (la !== lb) return la > lb ? -1 : 1
      return alpha
    }
    if (sortBy === 'spend') {
      const va = typeof clientMetrics[a.id]?.spend30 === 'number' ? clientMetrics[a.id].spend30 : -1
      const vb = typeof clientMetrics[b.id]?.spend30 === 'number' ? clientMetrics[b.id].spend30 : -1
      if (va !== vb) return vb - va
      return alpha
    }
    if (sortBy === 'revenue') {
      const ra = clientMetrics[a.id]?.revenue30
      const rb = clientMetrics[b.id]?.revenue30
      const va = ra == null ? -1 : ra
      const vb = rb == null ? -1 : rb
      if (va !== vb) return vb - va
      return alpha
    }
    return alpha
  })

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
          <span className="font-display text-lg text-ink">LoraMer</span>
        </div>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Client Manager</span>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-12">{/* LORAMER_CLIENTS_GRID_V1 - widened for the grid */}
        {metaError && (
          <div className="mb-6 bg-red-50 border border-red-300 px-4 py-3 rounded-lg max-w-2xl">
            <p className="text-sm text-red-700">{metaError}</p>
            <button onClick={() => setMetaError('')} className="text-xs text-red-500 hover:underline mt-1">Dismiss</button>
          </div>
        )}

        {/* Existing clients */}
        {clients.length > 0 && (
          <div className="mb-12">
            {/* LORAMER_CLIENTS_GRID_V1 - heading + sort control */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="font-display text-2xl text-ink">Your Clients</h2>
              <div className="flex items-center gap-2">
                <span className="metric-label">Sort</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as 'alpha' | 'recent' | 'spend' | 'revenue')}
                  className="text-xs font-sans border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-accent">
                  <option value="alpha">Alphabetical</option>
                  <option value="recent">Recent activity</option>
                  <option value="spend">Spend</option>
                  <option value="revenue">Revenue</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">{/* LORAMER_CLIENTS_GRID_V1 */}
              {sortedClients.map(client => {
                const googleConn = client.platform_connections.find(p => p.platform === 'google')
                const metaConn = client.platform_connections.find(p => p.platform === 'meta')
                const shopifyConn = client.platform_connections.find(p => p.platform === 'shopify')
                const wooConn = client.platform_connections.find(p => p.platform === 'woocommerce')  // LORAMER_WOO_CONNECT_V1
                // LORAMER_GA_PROPERTY_PICKER_V1
                const gaConn = client.platform_connections.find(p => p.platform === 'ga')
                const isExpanded = expandedProfile === client.id
                const m = clientMetrics[client.id]  // LORAMER_CLIENTS_GRID_V1
                return (
                  <div key={client.id} className="bg-white border border-border rounded-xl overflow-hidden shadow-sm">
                    {/* LORAMER_PILL_ROW_V1 - Linear-style client row */}
                    <div className="px-4 sm:px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => {
                            const hasConn = !!(googleConn || metaConn || shopifyConn || wooConn || gaConn)
                            if (hasConn) {
                              goToDashboard(client)
                            } else {
                              setExpandedProfile(isExpanded ? null : client.id)
                            }
                          }}
                        >
                          <p className="font-display text-base sm:text-lg text-ink mb-2 truncate">{client.name}</p>
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {/* Google pill */}
                            {googleConn ? (
                              <button onClick={(e) => { e.stopPropagation(); goToDashboard(client, 'google') }} className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity" style={{ background: '#4285F4' }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                Google
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setGoogleModal(client.id) }}
                                className="text-[11px] sm:text-xs font-sans px-2.5 py-0.5 rounded-full border border-border text-muted hover:text-ink hover:border-ink/40 transition-colors"
                              >
                                + Google
                              </button>
                            )}

                            {/* Meta pill */}
                            {metaConn ? (
                              <button onClick={(e) => { e.stopPropagation(); goToDashboard(client, 'meta') }} className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity" style={{ background: '#0866FF' }}>
                                <svg width="11" height="11" viewBox="0 0 36 24" fill="white" aria-hidden="true"><path d="M10.5 0C4.7 0 0 5.4 0 12s4.7 12 10.5 12c3.2 0 5.6-1.6 7.5-4.3 1.9 2.7 4.3 4.3 7.5 4.3C31.3 24 36 18.6 36 12S31.3 0 25.5 0c-3.2 0-5.6 1.6-7.5 4.3C16.1 1.6 13.7 0 10.5 0zm0 4c2.2 0 3.7 1.3 5.1 3.5L18 11l2.4-3.5C21.8 5.3 23.3 4 25.5 4 29.1 4 32 7.6 32 12s-2.9 8-6.5 8c-2.2 0-3.7-1.3-5.1-3.5L18 13l-2.4 3.5C14.2 18.7 12.7 20 10.5 20 6.9 20 4 16.4 4 12s2.9-8 6.5-8z"/></svg>
                                Meta
                              </button>
                            ) : (
                              <a
                                href={'/api/meta/auth?clientId=' + client.id}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] sm:text-xs font-sans px-2.5 py-0.5 rounded-full border border-border text-muted hover:text-ink hover:border-ink/40 transition-colors"
                              >
                                + Meta
                              </a>
                            )}

                            {/* Shopify pill */}
                            {shopifyConn ? (
                              <button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-client', client.id); localStorage.setItem('advar-active-tab', 'shopify') } catch {}; router.push('/dashboard') }} className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity" style={{ background: '#95BF47' }}>
                                <svg width="9" height="11" viewBox="0 0 109 124" fill="white" aria-hidden="true"><path d="M74.7 14.8c-.1 0-1.6.1-4.1.9-2.4-7-6.7-13.4-14.2-13.4h-.7C53.5.8 50.9 0 48.7 0c-17 0-25.1 21.2-27.7 32-6.6 2-11.3 3.5-11.9 3.7-3.7 1.2-3.8 1.3-4.3 4.7C4.4 42.9 0 78.3 0 78.3l71.9 13.5L111 83 86.3 17.5c-.7-1.9-2.4-2.8-4.1-2.7H74.7zM58.6 18.6c-1.3.4-2.8.9-4.4 1.3 0-1-.1-2-.2-2.9-.3-3.3-1.1-6-2.4-7.9 4.4.6 7.3 5.6 7 9.5zm-9.8 0c-3.2 1-6.7 2-10.2 3.1.9-3.7 2.6-7.3 4.7-9.7 1-1.1 2.4-2.3 4-3 1.6 3.4 1.6 8.2 1.5 9.6z"/></svg>
                                Shopify
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setShopifyModal(client.id); setShopifyDomain('') }}
                                className="text-[11px] sm:text-xs font-sans px-2.5 py-0.5 rounded-full border border-border text-muted hover:text-ink hover:border-ink/40 transition-colors"
                              >
                                + Shopify
                              </button>
                            )}
                            {/* WooCommerce pill - LORAMER_WOO_CONNECT_V1 */}
                            {wooConn ? (
                              <button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-client', client.id); localStorage.setItem('advar-active-tab', 'woocommerce') } catch {}; router.push('/dashboard') }} className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity" style={{ background: '#96588A' }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M2.4 4.8h19.2c1.32 0 2.4 1.08 2.4 2.4v10.32c0 1.32-1.08 2.4-2.4 2.4H14.4l3.36 5.04L8.4 19.92H2.4c-1.32 0-2.4-1.08-2.4-2.4V7.2c0-1.32 1.08-2.4 2.4-2.4zM3.84 6.6c-.6 0-.96.36-.96.84 0 .12 0 .24.12.48l3 9.6c.12.36.36.48.6.48.36 0 .48-.12.6-.48l1.32-5.28 1.92 5.04c.12.36.24.6.6.6s.48-.24.6-.6c1.32-3.6 2.04-5.4 2.04-5.4l1.32 4.8c.12.36.36.6.6.6.24 0 .48-.24.6-.48l3.12-9.6c.12-.24.12-.48.12-.6 0-.48-.36-.84-.96-.84-.48 0-.84.36-.96.84l-2.04 6.36-1.32-4.32c-.12-.36-.36-.6-.72-.6s-.6.24-.72.6l-1.92 5.4-1.68-5.4c-.12-.36-.36-.6-.72-.6s-.6.24-.72.6l-1.32 4.32-2.04-6.36c-.12-.48-.48-.84-.96-.84z"/></svg>
                                WooCommerce
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setWooModal(client.id); setWooDomain('') }}
                                className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-muted border border-dashed border-border hover:border-ink hover:text-ink transition-colors">
                                + WooCommerce
                              </button>
                            )}

                            {/* GA pill - LORAMER_GA_PROPERTY_PICKER_V1 */}
                            {gaConn ? (
                              <button onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('advar-active-client', client.id); localStorage.setItem('advar-active-tab', 'ga') } catch {}; router.push('/dashboard') }} className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white hover:opacity-90 transition-opacity" style={{ background: '#E8710A' }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M5 9.2h3V19H5zM10.5 5h3v14h-3zM16 13h3v6h-3z"/></svg>
                                Analytics
                              </button>
                            ) : (
                              <a
                                href={'/api/ga/start?clientId=' + client.id}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] sm:text-xs font-sans px-2.5 py-0.5 rounded-full border border-border text-muted hover:text-ink hover:border-ink/40 transition-colors"
                              >
                                + Analytics
                              </a>
                            )}

                            {/* LORAMER_CLIENTS_GRID_V1 - Mer pill (the deep surface, opens the overlay) */}
                            {profiledClientIds.has(client.id) ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedProfile(isExpanded ? null : client.id) }}
                                className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans font-medium px-2.5 py-0.5 rounded-full text-white"
                                style={{ background: '#2563eb' }}
                              >
                                <span style={{ fontSize: '10px' }}>&#8964;</span>
                                {DEEP_LABEL}
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedProfile(isExpanded ? null : client.id) }}
                                className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-sans px-2.5 py-0.5 rounded-full border border-border text-muted hover:text-ink hover:border-ink/40 transition-colors"
                              >
                                <span style={{ fontSize: '10px' }}>&#8964;</span>
                                {'+ ' + DEEP_LABEL}
                              </button>
                            )}

                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); const hasConn = !!(googleConn || metaConn || shopifyConn || wooConn || gaConn); if (hasConn) { goToDashboard(client) } else { setExpandedProfile(isExpanded ? null : client.id) } }} className="flex-shrink-0 text-muted hover:text-ink transition-colors font-sans">
                          <span className="hidden md:inline text-xs border border-border rounded-lg px-3 py-1.5 hover:border-ink/40">Open &#8594;</span>
                          <span className="md:hidden text-lg">&#8594;</span>
                        </button>
                      </div>

                      {/* LORAMER_CLIENTS_GRID_V1 - at-a-glance stat strip ("—" until metrics hydrate) */}
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="metric-label">30-Day Spend</p>
                            <p className="font-display text-base text-ink">{typeof m?.spend30 === 'number' ? fmtCardCurrency(m.spend30) : '—'}</p>
                          </div>
                          <div>
                            <p className="metric-label">30-Day Revenue</p>
                            <p className="font-display text-base text-ink flex items-center gap-1.5">
                              <span>{m?.revenue30 != null ? fmtCardCurrency(m.revenue30) : '—'}</span>
                              {m?.revenueSource === 'store' && <span title="Store revenue — Shopify/WooCommerce" className="inline-block w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />}
                              {m?.revenueSource === 'ga' && <span title="Estimated from GA4" className="inline-block w-1.5 h-1.5 rounded-full border border-accent flex-shrink-0" />}
                            </p>
                          </div>
                          <div>
                            <p className="metric-label">ROAS</p>
                            <p className="font-display text-base text-ink">{m?.roas != null ? m.roas.toFixed(2) + '×' : '—'}</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted font-mono mt-2">{m ? lastActiveLabel(m.lastActive) : '—'}</p>
                      </div>
                    </div>

                    {/* LORAMONNECTIONS_SECTION_V1 - Client details: connections + Lora profile.
                        LORAMER_CLIENTS_GRID_V1 - now rendered in the Mer overlay (twin desktop modal /
                        mobile bottom sheet) instead of the old inline expand-down. */}
                    {isExpanded && (() => {
                      const expandedContent = (
                      <div className="space-y-6">

                        {/* Connections section */}
                        <div>
                          <p className="text-xs font-sans uppercase tracking-widest text-muted mb-3">Connections</p>
                          <div className="space-y-2">
                            {googleConn && (<div>
                              <div className="flex items-center justify-between bg-white border border-border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0" style={{ background: '#4285F4' }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-sans font-medium text-ink">Google Ads</p>
                                    <p className="text-xs text-muted font-sans truncate">{googleConn.account_name}</p>
                                  </div>
                                </div>
                                {HEALTH_UI && googleConn.health === 'reconnect' ? (
                                  <ReconnectControl onClick={() => signIn('google', { callbackUrl: '/clients' })} scopeNote="Reconnects ALL your Google Ads accounts — they share one agency login." />
                                ) : (
                                  <span className="text-xs font-sans text-muted">Connected</span>
                                )}
                              </div>
                            <BackfillControl clientId={client.id} platform="google" onComplete={fetchClients} /></div>)}
                            {metaConn && (<div>
                              <div className="flex items-center justify-between bg-white border border-border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0" style={{ background: '#0866FF' }}>
                                    <svg width="10" height="10" viewBox="0 0 36 24" fill="white" aria-hidden="true"><path d="M10.5 0C4.7 0 0 5.4 0 12s4.7 12 10.5 12c3.2 0 5.6-1.6 7.5-4.3 1.9 2.7 4.3 4.3 7.5 4.3C31.3 24 36 18.6 36 12S31.3 0 25.5 0c-3.2 0-5.6 1.6-7.5 4.3C16.1 1.6 13.7 0 10.5 0zm0 4c2.2 0 3.7 1.3 5.1 3.5L18 11l2.4-3.5C21.8 5.3 23.3 4 25.5 4 29.1 4 32 7.6 32 12s-2.9 8-6.5 8c-2.2 0-3.7-1.3-5.1-3.5L18 13l-2.4 3.5C14.2 18.7 12.7 20 10.5 20 6.9 20 4 16.4 4 12s2.9-8 6.5-8z"/></svg>
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-sans font-medium text-ink">Meta Ads</p>
                                    <p className="text-xs text-muted font-sans truncate">{metaConn.account_name}</p>
                                  </div>
                                </div>
                                {HEALTH_UI && metaConn.health === 'reconnect' ? (
                                  <ReconnectControl href={'/api/meta/auth?clientId=' + client.id} scopeNote="Reconnects ALL your Meta accounts — they share one login." />
                                ) : (
                                  <button onClick={() => disconnectMeta(client.id, metaConn.id)} className="text-xs font-sans text-red-500 hover:text-red-700 hover:underline flex-shrink-0 ml-2">
                                    Disconnect
                                  </button>
                                )}
                              </div>
                            <BackfillControl clientId={client.id} platform="meta" onComplete={fetchClients} /></div>)}
                            {shopifyConn && (
                              <div className="flex items-center justify-between bg-white border border-border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0" style={{ background: '#95BF47' }}>
                                    <svg width="8" height="10" viewBox="0 0 109 124" fill="white" aria-hidden="true"><path d="M74.7 14.8c-.1 0-1.6.1-4.1.9-2.4-7-6.7-13.4-14.2-13.4h-.7C53.5.8 50.9 0 48.7 0c-17 0-25.1 21.2-27.7 32-6.6 2-11.3 3.5-11.9 3.7-3.7 1.2-3.8 1.3-4.3 4.7C4.4 42.9 0 78.3 0 78.3l71.9 13.5L111 83 86.3 17.5c-.7-1.9-2.4-2.8-4.1-2.7H74.7z"/></svg>
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-sans font-medium text-ink">Shopify</p>
                                    <p className="text-xs text-muted font-sans truncate">{shopifyConn.account_name}</p>
                                  </div>
                                </div>
                                {/* LORAMER_SHOPIFY_REAUTH_BUTTON_V1 — one-click Re-authorize (UNGATED: not behind HEALTH_UI or health==='reconnect'). Straight to the OAuth route, shop pre-filled from the stored connection account_id (the .myshopify.com domain) — no modal, no typed field. Replaces the broken blank-modal ReconnectControl path. Disconnect + the new-connection modal are unchanged. */}
                                <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                                  <a href={`/api/shopify/auth?clientId=${client.id}&shop=${shopifyConn.account_id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title="Re-authorize this Shopify store (re-grants access, e.g. full order history)"
                                    className="text-xs font-sans font-medium rounded px-2 py-0.5 text-white transition-colors hover:opacity-90" style={{ background: '#95BF47' }}>
                                    Re-authorize
                                  </a>
                                  <button onClick={async () => {
                                    await fetch('/api/clients/connections?id=' + shopifyConn.id, { method: 'DELETE' })
                                    fetchClients()
                                  }} className="text-xs font-sans text-red-500 hover:text-red-700 hover:underline">
                                    Disconnect
                                  </button>
                                </div>
                              </div>
                            )}
                            {wooConn && (  /* LORAMER_WOO_CONNECT_V1 */
                              <div className="flex items-center justify-between p-3 bg-surface rounded-lg">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#96588A' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2.4 4.8h19.2c1.32 0 2.4 1.08 2.4 2.4v10.32c0 1.32-1.08 2.4-2.4 2.4H14.4l3.36 5.04L8.4 19.92H2.4c-1.32 0-2.4-1.08-2.4-2.4V7.2c0-1.32 1.08-2.4 2.4-2.4z"/></svg>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-sans font-medium text-ink">WooCommerce</p>
                                    <p className="text-xs text-muted font-sans truncate">{wooConn.account_name}</p>
                                  </div>
                                </div>
                                {HEALTH_UI && wooConn.health === 'reconnect' ? (
                                  <ReconnectControl onClick={() => { setWooModal(client.id); setWooDomain('') }} scopeNote="Re-enter this store's WooCommerce API keys." />
                                ) : (
                                  <button onClick={async (e) => {
                                    e.stopPropagation()
                                    if (!confirm('Disconnect WooCommerce from this client?')) return
                                    await fetch('/api/clients/connections?id=' + wooConn.id, { method: 'DELETE' })
                                    fetchClients()
                                  }} className="text-xs text-muted hover:text-red-600 transition-colors font-sans">Disconnect</button>
                                )}
                              </div>
                            )}
                            {gaConn && (<div> {/* LORAMER_GA_PROPERTY_PICKER_V1 */}
                              <div className="flex items-center justify-between bg-white border border-border rounded-lg px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0" style={{ background: '#E8710A' }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M5 9.2h3V19H5zM10.5 5h3v14h-3zM16 13h3v6h-3z"/></svg>
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs font-sans font-medium text-ink">Google Analytics</p>
                                    <p className="text-xs text-muted font-sans truncate">{gaConn.account_name}</p>
                                  </div>
                                </div>
                                {HEALTH_UI && gaConn.health === 'reconnect' ? (
                                  <ReconnectControl href={'/api/ga/start?clientId=' + client.id} scopeNote="Re-authorize Google Analytics for this client." />
                                ) : (
                                  <span className="text-xs font-sans text-muted">Connected</span>
                                )}
                              </div>
                            <BackfillControl clientId={client.id} platform="ga" onComplete={fetchClients} /></div>)}
                            {!googleConn && !metaConn && !shopifyConn && !wooConn && !gaConn && (
                              <p className="text-xs font-sans text-muted italic">No platforms connected yet. Use the pills above to connect Meta or Shopify, or finish Google MCC setup.</p>
                            )}
                          </div>
                        </div>

                        {/* Lora profile section */}
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-xs font-sans uppercase tracking-widest text-muted">&#10022; What Lora should know</span>
                            <span className="text-xs text-muted font-sans">&mdash; the more Lora knows about this client, the sharper its analysis</span>
                          </div>
                          <ClientProfileForm client={client} onSave={() => { fetch('/api/clients/profiles').then(r => r.json()).then(d => setProfiledClientIds(new Set<string>(d.profiledClientIds || []))).catch(() => {}) }} />
                        </div>

                      </div>
                      )
                      return (
                        <>
                          {/* Desktop: centered modal over backdrop */}
                          <div className="hidden md:flex fixed inset-0 z-50 items-center justify-center p-6">
                            <div className="absolute inset-0 bg-ink/40" onClick={() => setExpandedProfile(null)} />
                            <div className="relative max-w-2xl w-full max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
                              <div className="sticky top-0 z-10 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
                                <p className="font-display text-lg text-ink truncate">{client.name}</p>
                                <button onClick={() => setExpandedProfile(null)} title="Close" className="text-muted hover:text-ink transition-colors text-lg leading-none px-1.5 py-0.5 hover:bg-surface rounded">&#215;</button>
                              </div>
                              <div className="px-6 py-5">{expandedContent}</div>
                            </div>
                          </div>
                          {/* Mobile: bottom sheet over backdrop */}
                          <div className="md:hidden fixed inset-0 z-50">
                            <div className="absolute inset-0 bg-ink/40" onClick={() => setExpandedProfile(null)} />
                            <div className="absolute left-0 right-0 bottom-0 top-[12%] rounded-t-2xl bg-white overflow-y-auto">
                              <div className="sticky top-0 z-10 bg-white border-b border-border px-4 py-3 flex items-center justify-between rounded-t-2xl">
                                <p className="font-display text-base text-ink truncate">{client.name}</p>
                                <button onClick={() => setExpandedProfile(null)} title="Close" className="text-muted hover:text-ink transition-colors text-lg leading-none px-1.5 py-0.5 hover:bg-surface rounded">&#215;</button>
                              </div>
                              <div className="px-4 py-4">{expandedContent}</div>
                            </div>
                          </div>
                        </>
                      )
                    })()}
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
        <div className="max-w-2xl">{/* LORAMER_CLIENTS_GRID_V1 - keep the form readable in the wide container */}
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

      {/* Google Ads account picker modal — LORAMER_GOOGLE_PILL_CONNECT_V1 */}
      {googleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-lg p-8 rounded-2xl shadow-xl">
            <h3 className="font-display text-xl text-ink mb-2">Connect a Google Ads Account</h3>
            <p className="text-sm text-muted font-mono mb-6">Pick the Google Ads account to connect to this client.</p>
            {unmappedAccounts.length === 0 ? (
              <p className="text-sm text-muted font-mono mb-6">No unassigned Google Ads accounts available. If you expected one, make sure the signed-in Google account has access to it.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mb-6">
                {unmappedAccounts.map(account => (
                  <button key={account.id} onClick={() => connectGoogleAccount(googleModal, account)} disabled={saving}
                    className="w-full text-left flex items-center gap-3 py-2 px-3 border border-border rounded-lg hover:bg-surface disabled:opacity-50">
                    <div>
                      <p className="text-sm text-ink">{account.name}</p>
                      <p className="text-xs font-mono text-muted">{account.id}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setGoogleModal(null)} disabled={saving}
              className="text-xs font-mono text-muted hover:text-ink border border-border rounded-lg px-4 py-2 disabled:opacity-50">
              {saving ? 'Connecting...' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Shopify connect modal — POST-INSTALL connection management for signed-in LoraMer users to add additional Shopify stores to their clients. NOT an install path. The install path is /api/shopify/install (Shopify-initiated). */}
      {/* LORAMER_GA_PROPERTY_PICKER_V1 — Google Analytics property picker */}
      {gaPicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-lg p-8 rounded-2xl shadow-xl">
            <h3 className="font-display text-xl text-ink mb-2">Connect Google Analytics</h3>
            <p className="text-sm text-muted font-mono mb-4">Pick the ONE property to connect to this client. LoraMer only reads the property you choose.</p>
            {gaConnecting && <p className="text-xs text-accent font-mono mb-2">Connecting...</p>}
            {gaPicker.loading ? (
              <p className="text-sm text-muted font-mono">Loading your properties...</p>
            ) : gaPicker.error ? (
              <p className="text-sm text-red-600 font-mono mb-4">{gaPicker.error}</p>
            ) : (
              <>
                <input type="text" value={gaSearch} onChange={e => setGaSearch(e.target.value)}
                  placeholder="Search properties..."
                  className="w-full text-sm border border-border bg-paper px-3 py-2 mb-3 rounded-lg focus:outline-none focus:border-accent" />
                <div className="space-y-1.5 max-h-80 overflow-y-auto mb-2">
                  {gaPicker.properties.filter(p => {
                    const q = gaSearch.trim().toLowerCase()
                    if (!q) return true
                    return (p.property_name + ' ' + p.account_name).toLowerCase().includes(q)
                  }).map(p => (
                    <button key={p.property_id} onClick={() => connectGaProperty(p)} disabled={gaConnecting}
                      className="w-full text-left border border-border rounded-lg px-3 py-2 hover:bg-surface disabled:opacity-50">
                      <p className="text-sm text-ink">{p.property_name}</p>
                      <p className="text-xs font-mono text-muted">{p.account_name} · {p.property_id}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => setGaPicker(null)} disabled={gaConnecting}
                className="text-xs font-mono text-muted hover:text-ink border border-border rounded-lg px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* WooCommerce connect modal - LORAMER_WOO_CONNECT_V1 */}
      {wooModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-display text-xl text-ink mb-2">Connect WooCommerce Store</h3>
            <p className="text-sm text-muted font-mono mb-6">Enter the store URL. You'll be sent to WordPress to approve access, then bounced back here connected.</p>
            <div className="mb-4">
              <input type="text" value={wooDomain} onChange={e => setWooDomain(e.target.value)}
                placeholder="https://yourstore.com"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-paper focus:outline-none focus:border-accent font-sans" />
              <p className="text-xs text-muted mt-1 font-mono">Must be HTTPS. WooCommerce 3.4+ required.</p>
            </div>
            <div className="flex flex-col gap-2">
              <a href={wooDomain.trim() ? '/api/woocommerce/auth?clientId=' + wooModal + '&shop=' + encodeURIComponent(wooDomain.trim()) : '#'}
                onClick={e => { if (!wooDomain.trim()) e.preventDefault() }}
                className={'btn-primary text-center ' + (!wooDomain.trim() ? 'opacity-50 pointer-events-none' : '')}>
                Connect WooCommerce
              </a>
              <button onClick={() => setWooModal(null)}
                className="text-sm text-muted hover:text-ink transition-colors font-sans">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* WooCommerce success notification - LORAMER_WOO_CONNECT_V1 */}
      {wooSuccess && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-sans" style={{ background: '#96588A' }}>
          ✓ WooCommerce connected successfully
        </div>
      )}

      {/* GA success notification - LORAMER_GA_PROPERTY_PICKER_V1 */}
      {gaSuccess && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-sans" style={{ background: '#E8710A' }}>
          ✓ Google Analytics connected
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
