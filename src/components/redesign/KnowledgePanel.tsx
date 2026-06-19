// LORAMER_KNOWLEDGE_UI_V1 — Knowledge panel (upload / list / delete) for the client page. Calls the deployed
// /api/knowledge route (validate/hash/extract/budget happen server-side). Scope-aware so the agency profile can
// reuse it later; client scope wired now. Renders only for allowlisted users (the page guards first).
'use client'
import { useEffect, useRef, useState } from 'react'
import styles from './redesign.module.css'

type Doc = { id: string; filename: string; word_count: number; status: string; created_at: string }
type Upload = { key: number; name: string; state: 'uploading' | 'error'; message?: string }

export default function KnowledgePanel({ scope, clientId }: { scope: 'client' | 'agency'; clientId?: string }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [usage, setUsage] = useState<{ used: number; budget: number }>({ used: 0, budget: scope === 'client' ? 25000 : 8000 })
  const [loading, setLoading] = useState(true)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef(0)

  const qs = `scope=${scope}` + (scope === 'client' && clientId ? `&clientId=${clientId}` : '')

  async function load() {
    try {
      const r = await fetch('/api/knowledge?' + qs)
      const d = await r.json()
      if (r.ok) { setDocs(d.docs || []); setUsage(d.usage || usage) }
    } catch { /* leave previous */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [qs]) // eslint-disable-line

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    for (const f of files) {
      const key = ++keyRef.current
      setUploads(u => [...u, { key, name: f.name, state: 'uploading' }])
      try {
        const fd = new FormData()
        fd.append('file', f); fd.append('scope', scope)
        if (scope === 'client' && clientId) fd.append('clientId', clientId)
        const res = await fetch('/api/knowledge', { method: 'POST', body: fd })
        const d = await res.json().catch(() => ({}))
        if (res.ok) { setUploads(u => u.filter(x => x.key !== key)); await load() }
        else setUploads(u => u.map(x => x.key === key ? { ...x, state: 'error', message: d.error || 'Upload failed' } : x))
      } catch {
        setUploads(u => u.map(x => x.key === key ? { ...x, state: 'error', message: 'Upload failed — check your connection' } : x))
      }
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this document?')) return
    try {
      const res = await fetch('/api/knowledge?id=' + id, { method: 'DELETE' })
      if (res.ok) await load()
      else { const d = await res.json().catch(() => ({})); alert(d.error || 'Could not remove the document') }
    } catch { alert('Could not remove the document — check your connection') }
  }

  const pct = Math.min(100, usage.budget ? (usage.used / usage.budget) * 100 : 0)
  const over = usage.used > usage.budget
  const near = !over && pct >= 90
  const fmt = (n: number) => n.toLocaleString()
  const noteScope = scope === 'agency' ? 'across all your clients' : 'about this client'

  return (
    <div className={styles.knPanel}>
      {/* drop-zone */}
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }}
      >
        <i className="ti ti-upload" />
        <span>Drop files here or <strong>click to upload</strong></span>
        <span className={styles.dropHint}>PDF · DOCX · XLSX · TXT · MD · CSV · up to 25 MB</span>
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv" className={styles.hiddenInput}
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = '' }} />
      </div>

      {/* per-file upload feedback */}
      {uploads.map(u => (
        <div key={u.key} className={styles.uploadRow}>
          {u.state === 'uploading'
            ? <span className={`${styles.fieldStatus} ${styles.fsSaving}`}><i className="ti ti-loader-2" /> Uploading {u.name}…</span>
            : <span className={`${styles.fieldStatus} ${styles.fsError}`}>
                <i className="ti ti-alert-triangle" /> {u.name}: {u.message}
                <button className={styles.retryBtn} onClick={() => setUploads(x => x.filter(y => y.key !== u.key))}>dismiss</button>
              </span>}
        </div>
      ))}

      {/* budget meter */}
      <div className={styles.budgetMeter}>
        <div className={styles.budgetBar}><div className={`${styles.budgetFill} ${over ? styles.budgetOver : near ? styles.budgetWarn : ''}`} style={{ width: pct + '%' }} /></div>
        <span className={`${styles.budgetLabel} ${over ? styles.fsError : near ? styles.fsDirty : ''}`}>
          {fmt(usage.used)} of ~{fmt(usage.budget)} words used{over ? ' — over budget' : near ? ' — almost full' : ''}
        </span>
      </div>

      <p className={styles.knNote}>Claude reads these as reference on every answer {noteScope}.</p>

      {/* list / empty state */}
      {loading ? (
        <p className={styles.emptyNote}>Loading…</p>
      ) : docs.length === 0 ? (
        <p className={styles.knEmpty}>Claude only knows the basics so far. Upload a brand guide, margins, personas, or strategy and Claude will use them in every answer {noteScope}.</p>
      ) : (
        <div className={styles.docList}>
          {docs.map(d => (
            <div key={d.id} className={styles.docRow}>
              <i className={`ti ti-file-text ${styles.docIcon}`} />
              <div className={styles.docMeta}>
                <span className={styles.docName}>{d.filename}</span>
                <span className={styles.docSub}>{fmt(d.word_count)} words · {new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <button className={styles.iconBtn} title="Remove" onClick={() => remove(d.id)}><i className="ti ti-trash" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
