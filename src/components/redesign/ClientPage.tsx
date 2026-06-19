// LORAMER_REDESIGN_CLIENTPAGE_A — the sectioned client page, WIRED TO REAL DATA via the existing gated API
// routes (/api/context, /api/memory). Sections: General · Connections (read-only + stubbed connect) · Rules
// (client_memory directives) · Facts (client_memory non-directive, source-marked). One responsive component
// (mobile = stacked, web = sectioned). Does NOT import/touch legacy /clients or /dashboard UI — only their
// shared API routes. Renders only for allowlisted users (the page guards first).
//
// PASS 1 cleanup: Primary KPI select removed; the free-text "Additional context" (user_notes) editor removed
// from the UI (the blob is retired as a field — build-claude-context still READS user_notes elsewhere, so
// nothing is lost). Facts is now purely the structured list, parallel to Rules.
'use client'
import { useEffect, useRef, useState } from 'react'
import styles from './redesign.module.css'
import Avatar from './Avatar'
import ShopifyIcon from './ShopifyIcon'
import NaicsPicker from './NaicsPicker'
import KnowledgePanel from './KnowledgePanel'

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  google: { label: 'Google Ads', icon: 'ti-brand-google' },
  meta: { label: 'Meta Ads', icon: 'ti-brand-meta' },
  ga: { label: 'Analytics', icon: 'ti-chart-bar' },
  shopify: { label: 'Shopify', icon: '__shopify__' },
  woocommerce: { label: 'WooCommerce', icon: 'ti-shopping-cart' },
}

type Conn = { platform: string; account_name: string | null; health: string | null }
type Fact = { id: number; content: string; category: string; source: string; pinned: boolean }
type GenField = 'business_descriptor' | 'service_area' | 'website'
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const TOLD = new Set(['user_explicit', 'user_conversation', 'bootstrap_legacy'])

export default function ClientPage({ clientId, clientName, connections }: { clientId: string; clientName: string; connections: Conn[] }) {
  const [descriptor, setDescriptor] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [website, setWebsite] = useState('')
  const [naicsInitial, setNaicsInitial] = useState<{ code: string; title: string }[]>([])
  const saved = useRef<Record<GenField, string>>({ business_descriptor: '', service_area: '', website: '' })
  // Per-field save lifecycle so the state is UNMISTAKABLE (steady, not a flash): idle/dirty/saving/saved/error.
  const [status, setStatus] = useState<Record<GenField, SaveState>>({ business_descriptor: 'idle', service_area: 'idle', website: 'idle' })
  const setFieldStatus = (f: GenField, s: SaveState) => setStatus(prev => ({ ...prev, [f]: s }))
  const current = (f: GenField) => (f === 'business_descriptor' ? descriptor : f === 'service_area' ? serviceArea : website)
  const [memory, setMemory] = useState<Fact[]>([])
  const [newRule, setNewRule] = useState('')
  const [newFact, setNewFact] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  async function loadMemory() {
    const r = await fetch('/api/memory?clientId=' + clientId)
    const d = await r.json()
    setMemory(d.memory || [])
  }
  useEffect(() => {
    fetch('/api/context?clientId=' + clientId).then(r => r.json()).then(d => {
      const c = d.context || {}
      const bd = c.business_descriptor || '', sa = c.service_area || '', ws = c.website || ''
      setDescriptor(bd); setServiceArea(sa); setWebsite(ws)
      setNaicsInitial(Array.isArray(c.naics_codes) ? c.naics_codes : [])
      saved.current = { business_descriptor: bd, service_area: sa, website: ws }
      // A persisted (non-empty) field starts in a steady "Saved" state; empty fields stay quiet (idle).
      setStatus({ business_descriptor: bd ? 'saved' : 'idle', service_area: sa ? 'saved' : 'idle', website: ws ? 'saved' : 'idle' })
    })
    loadMemory()
  }, [clientId]) // eslint-disable-line

  // Live "dirty" tracking as the user types — value differs from the last-persisted value.
  function onEdit(field: GenField, value: string, setter: (v: string) => void) {
    setter(value)
    const v = value.trim()
    setFieldStatus(field, v === saved.current[field] ? (saved.current[field] ? 'saved' : 'idle') : 'dirty')
  }

  // Save a single General field on blur, only if it changed. Light website tidy: add https:// if missing.
  // Loud, steady lifecycle: saving -> saved (stays) or error (stays, with retry). Never a silent fail.
  async function saveField(field: GenField, raw: string) {
    let value = raw.trim()
    if (field === 'website' && value && !/^https?:\/\//i.test(value)) { value = 'https://' + value; setWebsite(value) }
    if (value === saved.current[field]) { setFieldStatus(field, value ? 'saved' : 'idle'); return }
    setFieldStatus(field, 'saving')
    try {
      const res = await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, updates: { [field]: value } }) })
      if (!res.ok) throw new Error('save ' + res.status)
      saved.current = { ...saved.current, [field]: value }
      setFieldStatus(field, value ? 'saved' : 'idle')
    } catch (e) {
      console.error('[client-page] saveField failed:', field, e)
      setFieldStatus(field, 'error') // stays until a successful retry — never silently dropped
    }
  }
  async function addItem(content: string, category: 'directive' | 'fact', reset: () => void) {
    if (!content.trim()) return
    await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, content: content.trim(), category }) })
    reset(); await loadMemory()
  }
  async function patchItem(id: number, body: Record<string, unknown>) {
    await fetch('/api/memory', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    await loadMemory()
  }
  async function saveEdit(id: number) {
    if (editText.trim()) await patchItem(id, { content: editText.trim() })
    setEditingId(null); setEditText('')
  }

  // The unmistakable per-field save indicator.
  function FieldStatus({ field }: { field: GenField }) {
    const s = status[field]
    if (s === 'idle') return null
    if (s === 'dirty') return <span className={`${styles.fieldStatus} ${styles.fsDirty}`}><i className="ti ti-point-filled" /> Unsaved changes</span>
    if (s === 'saving') return <span className={`${styles.fieldStatus} ${styles.fsSaving}`}><i className="ti ti-loader-2" /> Saving…</span>
    if (s === 'saved') return <span className={`${styles.fieldStatus} ${styles.fsSaved}`}><i className="ti ti-circle-check" /> Saved</span>
    return (
      <span className={`${styles.fieldStatus} ${styles.fsError}`}>
        <i className="ti ti-alert-triangle" /> Couldn&apos;t save —
        <button className={styles.retryBtn} onClick={() => saveField(field, current(field))}>retry</button>
      </span>
    )
  }

  const rules = memory.filter(m => m.category === 'directive')
  const facts = memory.filter(m => m.category !== 'directive')

  function renderItem(m: Fact, showSource: boolean) {
    if (editingId === m.id) {
      return (
        <div key={m.id} className={styles.brainItem}>
          <textarea className={styles.brainInput} value={editText} onChange={e => setEditText(e.target.value)} rows={2} />
          <div className={styles.brainItemActions}>
            <button className={styles.addBtn} onClick={() => saveEdit(m.id)}>Save</button>
            <button className={styles.iconBtn} onClick={() => { setEditingId(null); setEditText('') }}>Cancel</button>
          </div>
        </div>
      )
    }
    return (
      <div key={m.id} className={styles.brainItem}>
        <div className={styles.brainItemContent}>
          {m.pinned && <i className={`ti ti-pinned ${styles.pinOn}`} />}
          <span>{m.content}</span>
          {showSource && (
            <span className={`${styles.sourceTag} ${TOLD.has(m.source) ? styles.sourceTold : styles.sourceLearned}`}>
              {TOLD.has(m.source) ? 'You told Lora' : 'Lora learned'}
            </span>
          )}
        </div>
        <div className={styles.brainItemActions}>
          {showSource && (
            <button className={styles.iconBtn} title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => patchItem(m.id, { pinned: !m.pinned })}>
              <i className={`ti ${m.pinned ? 'ti-pinned-off' : 'ti-pin'}`} />
            </button>
          )}
          <button className={styles.iconBtn} title="Edit" onClick={() => { setEditingId(m.id); setEditText(m.content) }}><i className="ti ti-pencil" /></button>
          <button className={styles.iconBtn} title="Archive" onClick={() => patchItem(m.id, { archived: true })}><i className="ti ti-archive" /></button>
        </div>
      </div>
    )
  }

  return (
    <>
      <h1 className={styles.title}>Client</h1>

      {/* 1) GENERAL */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>General</span>
        </div>
        <div className={styles.genTop}>
          <Avatar name={clientName} kind="client" className={styles.cardAvatar} />
          <span className={styles.genName}>{clientName}</span>
        </div>
        <div className={styles.genFields}>
          <label className={styles.field}>
            <span className={styles.fieldLabelRow}><span className={styles.fieldLabel}>What this business does</span><FieldStatus field="business_descriptor" /></span>
            <textarea className={styles.notesArea} rows={3} value={descriptor}
              onChange={e => onEdit('business_descriptor', e.target.value, setDescriptor)} onBlur={e => saveField('business_descriptor', e.target.value)}
              placeholder="Modular foam furniture for kids, sold DTC — buyers are parents, peak Nov–Dec" />
          </label>
          <NaicsPicker clientId={clientId} initialCodes={naicsInitial} />
          <div className={styles.genGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabelRow}><span className={styles.fieldLabel}>Service area</span><FieldStatus field="service_area" /></span>
              <input className={styles.formInput} type="text" value={serviceArea}
                onChange={e => onEdit('service_area', e.target.value, setServiceArea)} onBlur={e => saveField('service_area', e.target.value)}
                placeholder="Nationwide (US) · Local — Atlanta metro · Global" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabelRow}><span className={styles.fieldLabel}>Website</span><FieldStatus field="website" /></span>
              <input className={styles.formInput} type="text" inputMode="url" value={website}
                onChange={e => onEdit('website', e.target.value, setWebsite)} onBlur={e => saveField('website', e.target.value)}
                placeholder="https://…" />
            </label>
          </div>
        </div>
      </section>

      {/* 2) CONNECTIONS (read-only this pass + stubbed connect) */}
      <section className={styles.section}>
        <div className={styles.sectionHead}><span className={styles.sectionTitle}>Connections</span></div>
        {connections.length === 0 ? (
          <p className={styles.emptyNote}>No sources connected yet.</p>
        ) : (
          <div className={styles.connList}>
            {connections.map((c, i) => {
              const meta = PLATFORM_META[c.platform] || { label: c.platform, icon: 'ti-plug' }
              const h = c.health
              const hCls = h === 'healthy' ? styles.hHealthy : h === 'reconnect' ? styles.hReconnect : h === 'disconnected' ? styles.hDisconnected : styles.hUnknown
              const hLabel = h === 'healthy' ? 'Healthy' : h === 'reconnect' ? 'Reconnect' : h === 'disconnected' ? 'Disconnected' : 'Connected'
              return (
                <div key={i} className={styles.connRow}>
                  {meta.icon === '__shopify__' ? <ShopifyIcon size={18} /> : <i className={`ti ${meta.icon} ${styles.connIcon}`} />}
                  <div className={styles.connMeta}>
                    <span className={styles.connName}>{meta.label}</span>
                    {c.account_name && <span className={styles.connAcct}>{c.account_name}</span>}
                  </div>
                  <span className={`${styles.healthBadge} ${hCls}`}>{hLabel}</span>
                </div>
              )
            })}
          </div>
        )}
        {/* Stubbed connect affordance — does NOT bounce to legacy; real connect flow is a later build. */}
        <button className={styles.connectStub} type="button" disabled title="Connect flow coming soon">
          <i className="ti ti-plus" /> Connect a source <span>coming soon</span>
        </button>
      </section>

      {/* 3) RULES */}
      <section className={styles.section}>
        <div className={styles.brainHead}>
          <span className={styles.brainLabel}>Rules</span>
          <span className={styles.brainExplainer}>— directions Lora has to follow for this client</span>
        </div>
        <div className={styles.brainList}>
          {rules.length === 0 ? <p className={styles.emptyNote}>No rules yet.</p> : rules.map(m => renderItem(m, false))}
        </div>
        <div className={styles.brainAdd}>
          <textarea className={styles.brainInput} placeholder='e.g. "Always ignore ROAS — this account has no conversion tracking."' value={newRule} onChange={e => setNewRule(e.target.value)} rows={2} />
          <button className={styles.addBtn} onClick={() => addItem(newRule, 'directive', () => setNewRule(''))}><i className="ti ti-plus" /> Add rule</button>
        </div>
      </section>

      {/* 4) FACTS */}
      <section className={styles.section}>
        <div className={styles.brainHead}>
          <span className={styles.brainLabel}>Facts</span>
          <span className={styles.brainExplainer}>— what Lora knows about this client</span>
        </div>
        <div className={styles.brainList}>
          {facts.length === 0 ? <p className={styles.emptyNote}>No facts yet.</p> : facts.map(m => renderItem(m, true))}
        </div>
        <div className={styles.brainAdd}>
          <textarea className={styles.brainInput} placeholder='e.g. "B2B SaaS targeting facility managers; sales cycle ~90 days."' value={newFact} onChange={e => setNewFact(e.target.value)} rows={2} />
          <button className={styles.addBtn} onClick={() => addItem(newFact, 'fact', () => setNewFact(''))}><i className="ti ti-plus" /> Add fact</button>
        </div>
      </section>

      {/* 5) KNOWLEDGE (uploads) */}
      <section className={styles.section}>
        <div className={styles.brainHead}>
          <span className={styles.brainLabel}>Knowledge</span>
          <span className={styles.brainExplainer}>— docs Lora reads as reference on every answer</span>
        </div>
        <KnowledgePanel scope="client" clientId={clientId} />
      </section>
    </>
  )
}
