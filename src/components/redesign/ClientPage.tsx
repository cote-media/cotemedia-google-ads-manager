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
import { useEffect, useState } from 'react'
import styles from './redesign.module.css'
import Avatar from './Avatar'
import ShopifyIcon from './ShopifyIcon'

// Option list defined HERE (not imported from legacy). Industry stays for now (swapped for the free-text
// descriptor + service area + website in the NEXT pass, which needs a migration).
const INDUSTRIES = ['E-commerce', 'Lead Generation', 'SaaS / Software', 'Local Service', 'Brand / Media', 'App / Mobile', 'Non-profit', 'Healthcare', 'Real Estate', 'Other']

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  google: { label: 'Google Ads', icon: 'ti-brand-google' },
  meta: { label: 'Meta Ads', icon: 'ti-brand-meta' },
  ga: { label: 'Analytics', icon: 'ti-chart-bar' },
  shopify: { label: 'Shopify', icon: '__shopify__' },
  woocommerce: { label: 'WooCommerce', icon: 'ti-shopping-cart' },
}

type Conn = { platform: string; account_name: string | null; health: string | null }
type Fact = { id: number; content: string; category: string; source: string; pinned: boolean }

const TOLD = new Set(['user_explicit', 'user_conversation', 'bootstrap_legacy'])

export default function ClientPage({ clientId, clientName, connections }: { clientId: string; clientName: string; connections: Conn[] }) {
  const [industry, setIndustry] = useState('')
  const [savedTag, setSavedTag] = useState('')
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
      setIndustry((d.context && d.context.business_type) || '')
    })
    loadMemory()
  }, [clientId]) // eslint-disable-line

  async function saveIndustry(value: string) {
    setIndustry(value)
    await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, updates: { business_type: value } }) })
    setSavedTag('Saved ✓'); setTimeout(() => setSavedTag(''), 1500)
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
          {savedTag && <span className={styles.savedTag}>{savedTag}</span>}
        </div>
        <div className={styles.genTop}>
          <Avatar name={clientName} kind="client" className={styles.cardAvatar} />
          <span className={styles.genName}>{clientName}</span>
        </div>
        <div className={styles.genGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Industry</span>
            <select className={styles.formSelect} value={industry} onChange={e => saveIndustry(e.target.value)}>
              <option value="">Select…</option>
              {INDUSTRIES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
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
    </>
  )
}
