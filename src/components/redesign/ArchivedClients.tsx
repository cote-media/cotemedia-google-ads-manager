'use client'
// LORAMER_DELETE_CLIENT_V1 slice 2 — owner-only "Archived clients" list with Restore. Fed by an owner-scoped
// deleted_at IS NOT NULL query (server). Restore → PATCH /api/clients?id= (clears deleted_at + kicks the real
// backfill; deletes/creates nothing) → refresh. Mobile-first (wrap, ≥40px targets). Renders nothing if empty.
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Archived = { id: string; name: string; deleted_at: string }

export default function ArchivedClients({ archived }: { archived: Archived[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!archived.length) return null

  async function restore(id: string) {
    setBusyId(id); setError('')
    try {
      const res = await fetch('/api/clients?id=' + encodeURIComponent(id), { method: 'PATCH' })
      if (!res.ok) { const j = await res.json().catch(() => ({} as any)); setError(j.error || 'Could not restore. Try again.'); setBusyId(null); return }
      router.refresh() // restored client re-appears in the active list; capture resumes + gap backfills
    } catch { setError('Could not restore. Try again.'); setBusyId(null) }
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 720 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: '6px 0' }}>
        <i className={`ti ti-chevron-${open ? 'down' : 'right'}`} aria-hidden />
        Archived clients ({archived.length})
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {error && <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px' }} role="alert">{error}</div>}
          {archived.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', background: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Archived {new Date(c.deleted_at).toLocaleDateString()} — history kept</div>
              </div>
              <button type="button" disabled={busyId === c.id} onClick={() => restore(c.id)}
                style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', background: 'none', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 14px', minHeight: 40, cursor: busyId === c.id ? 'default' : 'pointer', opacity: busyId === c.id ? 0.5 : 1, flexShrink: 0 }}>
                {busyId === c.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
