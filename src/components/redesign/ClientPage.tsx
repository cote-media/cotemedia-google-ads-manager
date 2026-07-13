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
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation' // LORAMER_NEXT_CONNECT_V1 — refresh connections after disconnect
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

type Conn = { id: string; platform: string; account_name: string | null; account_id: string | null; health: string | null }

// LORAMER_NEXT_CONNECT_V1 — the 5 platforms rendered with truthful per-platform state (connected rows + a
// "not connected" row for any platform with no connection). Keys match PLATFORM_META + platform_connections.platform.
const CONNECT_PLATFORMS: string[] = ['google', 'meta', 'shopify', 'woocommerce', 'ga']
// F2(a): Shopify+Woo. F2b: Meta+GA now LIVE from -next (their account/property pickers ported below).
const NEXT_CONNECTABLE = new Set<string>(['shopify', 'woocommerce', 'meta', 'ga'])
// Shopify/Woo need a shop-domain / store-URL modal BEFORE OAuth; Meta/GA go straight to OAuth (the picker comes
// AFTER, back on -next: Meta reads the account list from the URL, GA fetches /api/ga/properties from the cookie).
const MODAL_PLATFORMS = new Set<string>(['shopify', 'woocommerce'])
type MetaAccount = { id: string; name: string }
type GaProperty = { account_id: string; account_name: string; property_id: string; property_name: string }
const connectBtnStyle: CSSProperties = { marginLeft: 8, fontSize: 12, color: '#94a3b8', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 10px', cursor: 'not-allowed', flexShrink: 0 }
const connectBtnActiveStyle: CSSProperties = { marginLeft: 8, fontSize: 12, color: '#0f172a', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }
const disconnectBtnStyle: CSSProperties = { marginLeft: 8, fontSize: 12, color: '#b91c1c', background: 'none', border: '1px solid #fecaca', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }
type Fact = { id: number; content: string; category: string; source: string; pinned: boolean }
type GenField = 'business_descriptor' | 'service_area' | 'website'
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const TOLD = new Set(['user_explicit', 'user_conversation', 'bootstrap_legacy'])

// LORAMER_CLIENT_VALUE_MODEL_V1 — the declared conversion/value model (multi-select; ≥1 required, hard-gated below).
const VALUE_MODELS: { key: string; label: string }[] = [
  { key: 'online-purchase', label: 'Online purchase' },
  { key: 'offline-sales', label: 'Offline sales' },
  { key: 'lead', label: 'Lead / engagement' },
]

export default function ClientPage({ clientId, clientName, connections, hasGoogleAdsToken }: { clientId: string; clientName: string; connections: Conn[]; hasGoogleAdsToken?: boolean }) {
  const [descriptor, setDescriptor] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [website, setWebsite] = useState('')
  const [naicsInitial, setNaicsInitial] = useState<{ code: string; title: string }[]>([])
  const saved = useRef<Record<GenField, string>>({ business_descriptor: '', service_area: '', website: '' })
  // Per-field save lifecycle so the state is UNMISTAKABLE (steady, not a flash): idle/dirty/saving/saved/error.
  const [status, setStatus] = useState<Record<GenField, SaveState>>({ business_descriptor: 'idle', service_area: 'idle', website: 'idle' })
  const setFieldStatus = (f: GenField, s: SaveState) => setStatus(prev => ({ ...prev, [f]: s }))
  const current = (f: GenField) => (f === 'business_descriptor' ? descriptor : f === 'service_area' ? serviceArea : website)
  // LORAMER_CLIENT_VALUE_MODEL_V1 — declared value model (jsonb array); the client surface is hard-gated until ≥1 is set.
  const [valueModel, setValueModel] = useState<string[]>([])
  const [vmLoaded, setVmLoaded] = useState(false)
  const [vmStatus, setVmStatus] = useState<SaveState>('idle')
  const [gateDraft, setGateDraft] = useState<string[]>([])
  const [memory, setMemory] = useState<Fact[]>([])
  const [newRule, setNewRule] = useState('')
  const [newFact, setNewFact] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  // LORAMER_NEXT_CONNECT_V1 — disconnect lifecycle (destructive; confirm-guarded; authoritative on failure).
  const router = useRouter()
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [connError, setConnError] = useState('')

  async function disconnect(conn: Conn) {
    const label = (PLATFORM_META[conn.platform] || { label: conn.platform }).label
    // Destructive-action guard — history is explicitly kept (store-forever); only the live connection is removed.
    if (!confirm(`Disconnect ${label}? Captured history is kept; this removes the live connection.`)) return
    setConnError('')
    setDisconnectingId(conn.id)
    try {
      const res = await fetch('/api/clients/connections?id=' + encodeURIComponent(conn.id), { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any))
        setConnError(j.error || `Could not disconnect ${label}. Try again.`)
        setDisconnectingId(null)
        return
      }
      setDisconnectingId(null)
      router.refresh() // re-run the server page → connections re-query without the removed row
    } catch {
      setConnError(`Could not disconnect ${label}. Try again.`)
      setDisconnectingId(null)
    }
  }

  // LORAMER_NEXT_CONNECT_V1 F2 — Shopify/Woo connect + reconnect from -next: navigate to the EXISTING start route
  // with returnTo = this client-profile, so the OAuth callback (Branch A / woo_return, validated) returns here.
  const [connectModal, setConnectModal] = useState<string | null>(null) // platform being connected: shopify | woocommerce
  const [connectShop, setConnectShop] = useState('')
  function startConnect(platform: string, shop: string) {
    const rt = encodeURIComponent('/dashboard-next/client-profile?clientId=' + clientId)
    const s = encodeURIComponent(shop.trim())
    const cid = encodeURIComponent(clientId)
    if (platform === 'shopify') window.location.href = `/api/shopify/auth?clientId=${cid}&shop=${s}&returnTo=${rt}`
    else if (platform === 'woocommerce') window.location.href = `/api/woocommerce/auth?clientId=${cid}&shop=${s}&returnTo=${rt}`
    else if (platform === 'meta') window.location.href = `/api/meta/auth?clientId=${cid}&returnTo=${rt}`
    else if (platform === 'ga') window.location.href = `/api/ga/start?clientId=${cid}&returnTo=${rt}`
    else if (platform === 'google') window.location.href = `/api/google-ads/connect/start?returnTo=${rt}` // decoupler (owner-level; no clientId)
  }

  // LORAMER_NEXT_CONNECT_V1 F2b — Meta/GA two-step PICKERS ported to -next. After OAuth the callback returns HERE
  // (via returnTo): Meta with ?meta_accounts=<list>, GA with ?ga_oauth=success (+ the path=/ ga_oauth_tokens cookie).
  const [metaPicker, setMetaPicker] = useState<MetaAccount[] | null>(null)
  const [gaPicker, setGaPicker] = useState<GaProperty[] | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)
  const [pickerError, setPickerError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const metaAccounts = p.get('meta_accounts')
    const gaOauth = p.get('ga_oauth')
    if (metaAccounts) {
      try { setMetaPicker(JSON.parse(metaAccounts) as MetaAccount[]) } catch { setPickerError('Could not read the Meta account list. Try reconnecting.') }
    } else if (gaOauth === 'success') {
      fetch('/api/ga/properties').then(r => r.json()).then(d => {
        if (Array.isArray(d.properties)) setGaPicker(d.properties as GaProperty[])
        else setPickerError(d.error || 'Could not list Google Analytics properties.')
      }).catch(() => setPickerError('Could not reach Google Analytics.'))
    } else if (gaOauth && gaOauth !== 'success') {
      setPickerError('Google Analytics authorization did not complete. Try again.')
    }
    // LORAMER_NEXT_CONNECT_V1 F3 — the decoupler returns here with gads_connected=true (server hasGoogleAdsToken is
    // now true → the Google row shows Authorized on this render) or gads_error=<reason>.
    const gadsErr = p.get('gads_error')
    if (gadsErr) setPickerError('Google Ads authorization did not complete (' + gadsErr + '). Try again.')
    // Clean the connect params from the URL so a refresh doesn't re-trigger.
    if (metaAccounts || gaOauth || p.get('gads_connected') || gadsErr) window.history.replaceState({}, '', '/dashboard-next/client-profile?clientId=' + clientId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function finalizeMeta(acct: MetaAccount) {
    setPickerBusy(true); setPickerError('')
    try {
      const res = await fetch('/api/clients/connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, platform: 'meta', account_id: acct.id, account_name: acct.name }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({} as any)); setPickerError(j.error || 'Could not connect the Meta account. Try again.'); setPickerBusy(false); return }
      setMetaPicker(null); setPickerBusy(false); router.refresh()
    } catch { setPickerError('Could not connect the Meta account. Try again.'); setPickerBusy(false) }
  }

  async function finalizeGa(p: GaProperty) {
    setPickerBusy(true); setPickerError('')
    try {
      const res = await fetch('/api/ga/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: p.property_id, property_name: p.property_name, account_id: p.account_id, account_name: p.account_name }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({} as any)); setPickerError(j.error || 'Could not connect the property. Try again.'); setPickerBusy(false); return }
      setGaPicker(null); setPickerBusy(false); router.refresh()
    } catch { setPickerError('Could not connect the property. Try again.'); setPickerBusy(false) }
  }

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
      // LORAMER_CLIENT_VALUE_MODEL_V1 — load the declared value model; vmLoaded gates the blocking prompt (no flash pre-load).
      const vm = Array.isArray(c.value_model) ? c.value_model : []
      setValueModel(vm); setVmStatus(vm.length ? 'saved' : 'idle'); setVmLoaded(true)
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
  // LORAMER_CLIENT_VALUE_MODEL_V1 — persist the value-model array via the generic /api/context spread (no server change).
  async function saveValueModel(next: string[]) {
    setValueModel(next); setVmStatus('saving')
    try {
      const res = await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, updates: { value_model: next } }) })
      if (!res.ok) throw new Error('save ' + res.status)
      setVmStatus(next.length ? 'saved' : 'idle')
    } catch (e) {
      console.error('[client-page] saveValueModel failed:', e); setVmStatus('error') // stays until a successful retry
    }
  }
  const toggleValueModel = (key: string) => saveValueModel(valueModel.includes(key) ? valueModel.filter(k => k !== key) : [...valueModel, key])

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
      {/* LORAMER_CLIENT_VALUE_MODEL_V1 — HARD GATE: non-dismissable blocking prompt until value_model has ≥1 selection. */}
      {vmLoaded && valueModel.length === 0 && (
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--paper, #12141a)', color: 'inherit', border: '1px solid var(--border, #33384a)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 440 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Set this client’s value model to continue</h2>
            <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 16 }}>How does {clientName} make money? Pick all that apply — Lora uses this to read conversions and ROAS correctly.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {VALUE_MODELS.map(vm => {
                const on = gateDraft.includes(vm.key)
                return (
                  <button key={vm.key} type="button"
                    onClick={() => setGateDraft(d => d.includes(vm.key) ? d.filter(k => k !== vm.key) : [...d, vm.key])}
                    style={{ padding: '12px 16px', borderRadius: 10, textAlign: 'left', fontSize: 15, cursor: 'pointer', color: 'inherit',
                      border: on ? '2px solid #2563eb' : '1px solid var(--border, #33384a)', background: on ? 'rgba(37,99,235,0.12)' : 'transparent' }}>
                    <span style={{ marginRight: 8 }}>{on ? '☑' : '☐'}</span>{vm.label}
                  </button>
                )
              })}
            </div>
            <button type="button" disabled={gateDraft.length === 0 || vmStatus === 'saving'} onClick={() => saveValueModel(gateDraft)}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 600, color: '#fff',
                background: gateDraft.length ? '#2563eb' : '#3a3f4d', cursor: gateDraft.length ? 'pointer' : 'not-allowed' }}>
              {vmStatus === 'saving' ? 'Saving…' : 'Save & continue'}
            </button>
            {vmStatus === 'error' && <p style={{ color: '#f87171', fontSize: 13, marginTop: 8 }}>Couldn’t save — try again.</p>}
          </div>
        </div>
      )}

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
          {/* LORAMER_CLIENT_VALUE_MODEL_V1 — inline editor (the hard gate below forces ≥1 before the client is usable). */}
          <label className={styles.field}>
            <span className={styles.fieldLabelRow}><span className={styles.fieldLabel}>Value model</span>
              {vmStatus === 'saving' && <span className={styles.fieldStatus}>Saving…</span>}
              {vmStatus === 'saved' && <span className={styles.fieldStatus}>Saved</span>}
              {vmStatus === 'error' && <span className={styles.fieldStatus}>Couldn’t save</span>}
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {VALUE_MODELS.map(vm => {
                const on = valueModel.includes(vm.key)
                return (
                  <button key={vm.key} type="button" onClick={() => toggleValueModel(vm.key)}
                    style={{ padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: on ? '1px solid #2563eb' : '1px solid var(--border, #33384a)',
                      background: on ? '#2563eb' : 'transparent', color: on ? '#fff' : 'inherit' }}>
                    {vm.label}
                  </button>
                )
              })}
            </div>
          </label>
        </div>
      </section>

      {/* 2) CONNECTIONS — LORAMER_NEXT_CONNECT_V1: truthful per-platform state + working DISCONNECT (reuse
          DELETE /api/clients/connections — removes the connection row ONLY, captured history kept). Connect/
          Reconnect are DISABLED this flight (return-to-next wiring is Flight 2); a cross-app bounce to legacy
          mid-next reads as broken, so an honestly-disabled control is the less-misleading state. */}
      <section className={styles.section}>
        <div className={styles.sectionHead}><span className={styles.sectionTitle}>Connections</span></div>
        <div className={styles.connList}>
          {CONNECT_PLATFORMS.map((pf) => {
            const meta = PLATFORM_META[pf] || { label: pf, icon: 'ti-plug' }
            const icon = meta.icon === '__shopify__' ? <ShopifyIcon size={18} /> : <i className={`ti ${meta.icon} ${styles.connIcon}`} />
            // LORAMER_NEXT_CONNECT_V1 F3 — Google Ads is TWO-LEVEL: the owner adwords token (hasGoogleAdsToken, the
            // decoupler's target) + a per-client customer_id mapping (the legacy account picker — F3b). Connect/
            // Reconnect key on the owner token; assigning THIS client's ad account is flagged as the current-app step.
            if (pf === 'google') {
              const gc = connections.find((c) => c.platform === 'google')
              const authorized = !!hasGoogleAdsToken
              const busyG = gc ? disconnectingId === gc.id : false
              const gBadge = gc ? (gc.health === 'healthy' ? styles.hHealthy : gc.health === 'reconnect' ? styles.hReconnect : styles.hUnknown) : authorized ? styles.hUnknown : styles.hDisconnected
              return (
                <div key="google" className={styles.connRow}>
                  {icon}
                  <div className={styles.connMeta}>
                    <span className={styles.connName}>Google Ads</span>
                    <span className={styles.connAcct}>{gc?.account_name ? gc.account_name : authorized ? 'Authorized — assign this client’s ad account in the current app' : 'Not connected'}</span>
                  </div>
                  <span className={`${styles.healthBadge} ${gBadge}`}>{gc ? 'Connected' : authorized ? 'Authorized' : 'Not connected'}</span>
                  <button type="button" onClick={() => startConnect('google', '')} title={authorized ? 'Re-authorize Google Ads' : 'Authorize Google Ads for your account'} style={connectBtnActiveStyle}>{authorized ? 'Reconnect' : 'Connect Google Ads'}</button>
                  {gc && <button type="button" onClick={() => disconnect(gc)} disabled={busyG} style={{ ...disconnectBtnStyle, opacity: busyG ? 0.5 : 1 }}>{busyG ? 'Disconnecting…' : 'Disconnect'}</button>}
                </div>
              )
            }
            const rows = connections.filter((c) => c.platform === pf)
            if (rows.length === 0) {
              // NOT connected — truthful; no false "connected".
              return (
                <div key={pf} className={styles.connRow}>
                  {icon}
                  <div className={styles.connMeta}>
                    <span className={styles.connName}>{meta.label}</span>
                    <span className={styles.connAcct}>Not connected</span>
                  </div>
                  <span className={`${styles.healthBadge} ${styles.hDisconnected}`}>Not connected</span>
                  {NEXT_CONNECTABLE.has(pf) ? (
                    <button type="button" onClick={() => { if (MODAL_PLATFORMS.has(pf)) { setConnectShop(''); setConnectModal(pf) } else { startConnect(pf, '') } }} style={connectBtnActiveStyle}>Connect</button>
                  ) : (
                    <button type="button" disabled title="Connecting from here arrives in the next update" style={connectBtnStyle}>Connect</button>
                  )}
                </div>
              )
            }
            return rows.map((c) => {
              const h = c.health
              const hCls = h === 'healthy' ? styles.hHealthy : h === 'reconnect' ? styles.hReconnect : h === 'disconnected' ? styles.hDisconnected : styles.hUnknown
              const hLabel = h === 'healthy' ? 'Healthy' : h === 'reconnect' ? 'Reconnect' : h === 'disconnected' ? 'Disconnected' : 'Connected'
              const busy = disconnectingId === c.id
              return (
                <div key={c.id} className={styles.connRow}>
                  {icon}
                  <div className={styles.connMeta}>
                    <span className={styles.connName}>{meta.label}</span>
                    {c.account_name && <span className={styles.connAcct}>{c.account_name}</span>}
                  </div>
                  <span className={`${styles.healthBadge} ${hCls}`}>{hLabel}</span>
                  {NEXT_CONNECTABLE.has(pf) ? (
                    <button type="button" onClick={() => startConnect(pf, c.account_id || '')} disabled={!c.account_id} title="Re-authorize this connection" style={connectBtnActiveStyle}>Reconnect</button>
                  ) : (
                    <button type="button" disabled title="Reconnecting from here arrives in the next update" style={connectBtnStyle}>Reconnect</button>
                  )}
                  <button type="button" onClick={() => disconnect(c)} disabled={busy} style={{ ...disconnectBtnStyle, opacity: busy ? 0.5 : 1 }}>
                    {busy ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              )
            })
          })}
        </div>
        {connError && <p className={styles.emptyNote} style={{ color: '#b91c1c' }} role="alert">{connError}</p>}

        {/* LORAMER_NEXT_CONNECT_V1 F2b — Meta account-picker / GA property-picker (single-select; UNIQUE(client_id,
            platform) = one per client). Shown when the callback returned here with a list; pick → REUSED finalize
            (Meta: POST /api/clients/connections [hardened] · GA: POST /api/ga/connect) → refresh. mobile-clean. */}
        {(metaPicker || gaPicker) && (
          <div onClick={() => { if (!pickerBusy) { setMetaPicker(null); setGaPicker(null) } }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 460, borderRadius: 16, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{metaPicker ? 'Choose a Meta ad account' : 'Choose a Google Analytics property'}</h3>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>Connect one to this client.</p>
              {pickerError && <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }} role="alert">{pickerError}</div>}
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {metaPicker && (metaPicker.length === 0
                  ? <p style={{ fontSize: 13, color: '#64748b' }}>No Meta ad accounts found on this login.</p>
                  : metaPicker.map((a) => (
                    <button key={a.id} type="button" disabled={pickerBusy} onClick={() => finalizeMeta(a)} style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', cursor: pickerBusy ? 'default' : 'pointer', opacity: pickerBusy ? 0.6 : 1 }}>
                      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>{a.name || a.id}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{a.id}</div>
                    </button>
                  )))}
                {gaPicker && (gaPicker.length === 0
                  ? <p style={{ fontSize: 13, color: '#64748b' }}>No Google Analytics properties found on this login.</p>
                  : gaPicker.map((p) => (
                    <button key={p.property_id} type="button" disabled={pickerBusy} onClick={() => finalizeGa(p)} style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', cursor: pickerBusy ? 'default' : 'pointer', opacity: pickerBusy ? 0.6 : 1 }}>
                      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>{p.property_name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{p.account_name} · {p.property_id}</div>
                    </button>
                  )))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" disabled={pickerBusy} onClick={() => { setMetaPicker(null); setGaPicker(null) }} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer' }}>{pickerBusy ? 'Connecting…' : 'Cancel'}</button>
              </div>
            </div>
          </div>
        )}

        {/* LORAMER_NEXT_CONNECT_V1 F2 — Shopify/Woo connect modal (collects the shop domain / store URL, then
            navigates to the existing start route with returnTo). mobile-clean: max-w 420, full-width input. */}
        {connectModal && (
          <div onClick={() => setConnectModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 420, borderRadius: 16, padding: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Connect {connectModal === 'shopify' ? 'Shopify' : 'WooCommerce'}</h3>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                {connectModal === 'shopify' ? 'Enter your Shopify store domain — you’ll authorize LoraMer on Shopify.' : 'Enter your WooCommerce store URL — you’ll approve access on your store.'}
              </p>
              <input
                type="text"
                value={connectShop}
                onChange={(e) => setConnectShop(e.target.value)}
                placeholder={connectModal === 'shopify' ? 'your-store.myshopify.com' : 'https://yourstore.com'}
                autoFocus
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, marginBottom: 12, outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setConnectModal(null)} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                <button
                  type="button"
                  onClick={() => startConnect(connectModal, connectShop)}
                  disabled={connectModal === 'shopify' ? !connectShop.includes('.myshopify.com') : !connectShop.trim()}
                  style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: '#0f172a', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (connectModal === 'shopify' ? !connectShop.includes('.myshopify.com') : !connectShop.trim()) ? 0.5 : 1 }}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
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
