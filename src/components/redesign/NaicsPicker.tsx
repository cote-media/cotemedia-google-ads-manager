// LORAMER_NAICS_V1 — searchable NAICS 2022 picker for the client page General section. Imports ONLY the slim
// naics-index.json (137KB, {code,title}) and ONLY via a DYNAMIC import on first focus, so it stays out of the
// page's initial JS. NEVER imports naics-definitions.json (that 763KB file is server-only — definitions are
// resolved at prompt time). Auto-saves the full naics_codes array to /api/context on every add/remove with the
// same loud save-state visual as the General fields.
'use client'
import { useEffect, useRef, useState } from 'react'
import styles from './redesign.module.css'

type Sel = { code: string; title: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function NaicsPicker({ clientId, initialCodes }: { clientId: string; initialCodes: Sel[] }) {
  const [selected, setSelected] = useState<Sel[]>(initialCodes)
  const [status, setStatus] = useState<SaveState>('idle')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const sixDigit = useRef<Sel[] | null>(null)      // lazy-loaded index (6-digit only)
  const [, forceRender] = useState(0)
  const touched = useRef(false)

  // Hydrate from the client's stored codes once the parent's context load arrives (no second fetch). Guarded
  // so a user edit before load completes is never clobbered.
  useEffect(() => {
    if (!touched.current && initialCodes.length) setSelected(initialCodes)
  }, [initialCodes])

  async function ensureIndex() {
    if (sixDigit.current) return
    const mod = await import('@/lib/naics/naics-index.json') // dynamic → separate async chunk, not main bundle
    const all = (mod.default as Sel[]) || []
    sixDigit.current = all.filter(e => e.code.length === 6) // the 1,012 national industries only
    forceRender(n => n + 1)
  }

  async function persist(next: Sel[]) {
    setStatus('saving')
    try {
      const res = await fetch('/api/context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, updates: { naics_codes: next } }) })
      if (!res.ok) throw new Error('save ' + res.status)
      setStatus('saved')
    } catch (e) {
      console.error('[naics-picker] save failed:', e)
      setStatus('error') // stays until a successful retry — never silent
    }
  }
  function add(c: Sel) {
    if (selected.some(s => s.code === c.code)) return
    touched.current = true
    const next = [...selected, { code: c.code, title: c.title }]
    setSelected(next); setQuery(''); persist(next)
  }
  function remove(code: string) {
    touched.current = true
    const next = selected.filter(s => s.code !== code)
    setSelected(next); persist(next)
  }

  const q = query.trim().toLowerCase()
  const results = (!q || !sixDigit.current) ? [] : sixDigit.current
    .filter(e => !selected.some(s => s.code === e.code))
    .filter(e => e.title.toLowerCase().includes(q) || e.code.startsWith(q))
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, 50)

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabelRow}>
        <span className={styles.fieldLabel}>Industry classification (NAICS)</span>
        {status === 'saving' && <span className={`${styles.fieldStatus} ${styles.fsSaving}`}><i className="ti ti-loader-2" /> Saving…</span>}
        {status === 'saved' && <span className={`${styles.fieldStatus} ${styles.fsSaved}`}><i className="ti ti-circle-check" /> Saved</span>}
        {status === 'error' && (
          <span className={`${styles.fieldStatus} ${styles.fsError}`}>
            <i className="ti ti-alert-triangle" /> Couldn&apos;t save —
            <button className={styles.retryBtn} onClick={() => persist(selected)}>retry</button>
          </span>
        )}
      </span>
      <p className={styles.naicsHelp}>Optional. Lets Lora use the official definition of your industry. North American standard (US/Canada/Mexico).</p>

      {selected.length > 0 && (
        <div className={styles.naicsChips}>
          {selected.map(s => (
            <span key={s.code} className={styles.naicsChip}>
              {s.code} — {s.title}
              <button className={styles.naicsChipX} onClick={() => remove(s.code)} aria-label={`Remove ${s.code}`}><i className="ti ti-x" /></button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.naicsSearchWrap}>
        <input
          className={styles.formInput}
          type="text"
          value={query}
          placeholder="Search by industry or code — e.g. pest, restaurant, 561710"
          onFocus={() => { ensureIndex(); setOpen(true) }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {open && results.length > 0 && (
          <div className={styles.naicsDropdown}>
            {results.map(e => (
              <button key={e.code} className={styles.naicsOption} onMouseDown={() => add(e)}>
                <span className={styles.naicsOptCode}>{e.code}</span> — {e.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
