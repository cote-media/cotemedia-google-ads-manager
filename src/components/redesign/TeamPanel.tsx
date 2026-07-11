// LORAMER_RBAC_INVITE_V1 — the -next Team surface. TWO FLOWS branched on org_type:
//   solo   → SIMPLE: invite a teammate (email + role) → all_clients grant (a single business; the teammate helps run it).
//   agency → FULL: email + role + per-client checklist + "All clients (incl. future)" = all_clients grant.
// Both POST /api/org/invite. Shows the current team (GET /api/org/team) with each member's access + a revoke action.
// Mobile-first, TW-caliber; full names (no truncation). Owner/admin only (the route 403s otherwise → honest empty).
'use client'
import { useEffect, useState } from 'react'
import styles from './team.module.css'

type Access = { all_clients: boolean; client_ids: string[]; client_names: string[] }
type Member = { member_email: string; role: string; invited_by: string; created_at: string; is_owner: boolean; access: Access }
type TeamData = { orgType: 'solo' | 'agency'; ownerEmail: string; callerRole: string; clients: { id: string; name: string }[]; members: Member[] }

export default function TeamPanel() {
  const [data, setData] = useState<TeamData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [allClients, setAllClients] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setState('loading')
    fetch('/api/org/team')
      .then((r) => (r.status === 403 ? Promise.reject('forbidden') : r.ok ? r.json() : Promise.reject('error')))
      .then((d: TeamData) => { setData(d); setAllClients(d.orgType === 'solo'); setState('ready') })
      .catch((e) => setState(e === 'forbidden' ? 'forbidden' : 'error'))
  }
  useEffect(load, [])

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const invite = async () => {
    setMsg(null)
    const grants = allClients ? { all_clients: true } : { all_clients: false, client_ids: Array.from(picked) }
    if (!allClients && picked.size === 0) { setMsg('Pick at least one client, or choose “All clients”.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/org/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ member_email: email, role, grants }) })
      const j = await r.json()
      if (!r.ok) { setMsg(j?.error || 'Invite failed'); setBusy(false); return }
      setMsg(`Invited ${email}`); setEmail(''); setPicked(new Set()); setAllClients(data?.orgType === 'solo'); setRole('member')
      load()
    } catch { setMsg('Invite failed') }
    setBusy(false)
  }

  const revoke = async (memberEmail: string) => {
    if (!window.confirm(`Remove ${memberEmail} from the team?`)) return
    setBusy(true)
    try {
      const r = await fetch('/api/org/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ member_email: memberEmail }) })
      if (!r.ok) { const j = await r.json(); setMsg(j?.error || 'Revoke failed') }
      load()
    } catch { setMsg('Revoke failed') }
    setBusy(false)
  }

  if (state === 'loading') return <div className={styles.wrap}><p className={styles.muted}>Loading team…</p></div>
  if (state === 'forbidden') return <div className={styles.wrap}><h1 className={styles.h1}>Team</h1><p className={styles.muted}>Only an organization’s owner or an admin can manage the team.</p></div>
  if (state === 'error' || !data) return <div className={styles.wrap}><h1 className={styles.h1}>Team</h1><p className={styles.err}>Couldn’t load your team. Try again.</p></div>

  const isAgency = data.orgType === 'agency'
  return (
    <div className={styles.wrap}>
      <h1 className={styles.h1}>Team</h1>
      <p className={styles.sub}>{isAgency ? 'Invite teammates and choose which clients each can see.' : 'Invite a teammate to help run your account.'}</p>

      {/* ── Invite form ── */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>{isAgency ? 'Invite a teammate' : 'Invite a teammate'}</div>
        <label className={styles.label}>Email</label>
        <input className={styles.input} type="email" inputMode="email" autoCapitalize="none" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className={styles.label}>Role</label>
        <div className={styles.seg}>
          {(['member', 'admin'] as const).map((r) => (
            <button key={r} type="button" className={role === r ? styles.segOn : styles.segBtn} onClick={() => setRole(r)}>{r === 'admin' ? 'Admin' : 'Member'}</button>
          ))}
        </div>
        <p className={styles.hint}>{role === 'admin' ? 'Admins can invite and manage teammates.' : 'Members can view what you grant them.'}</p>

        {isAgency && (
          <>
            <label className={styles.label}>Client access</label>
            <label className={styles.checkAll}>
              <input type="checkbox" checked={allClients} onChange={(e) => setAllClients(e.target.checked)} />
              <span>All clients <span className={styles.muted}>(including ones you add later)</span></span>
            </label>
            {!allClients && (
              <div className={styles.checklist}>
                {data.clients.length === 0 && <p className={styles.muted}>No clients yet.</p>}
                {data.clients.map((c) => (
                  <label key={c.id} className={styles.checkRow}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <button type="button" className={styles.primary} disabled={busy || !email} onClick={invite}>{busy ? 'Working…' : 'Send invite'}</button>
        {msg && <p className={styles.msg}>{msg}</p>}
      </section>

      {/* ── Current team ── */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>Current team</div>
        <ul className={styles.members}>
          {data.members.map((m) => (
            <li key={m.member_email} className={styles.member}>
              <div className={styles.memMain}>
                <span className={styles.memEmail}>{m.member_email}</span>
                <span className={styles.role}>{m.is_owner ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</span>
              </div>
              <div className={styles.memAccess}>
                {m.is_owner || m.access.all_clients
                  ? <span className={styles.muted}>All clients</span>
                  : m.access.client_names.length
                    ? <span className={styles.muted}>{m.access.client_names.join(' · ')}</span>
                    : <span className={styles.muted}>No client access</span>}
              </div>
              {!m.is_owner && <button type="button" className={styles.revoke} disabled={busy} onClick={() => revoke(m.member_email)}>Remove</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
