// LORAMER_REDESIGN_INCA — the mobile bottom tab bar (Overview · Lora · Mer). Hidden ≥ md via CSS.
// LORAMER_NEXT_PARITY_V1 (P2-A): the Lora tab now OPENS the Ask-Lora chat sheet (dispatches 'loramer:open-chat',
// which ChatLauncher listens for) instead of routing to a stub page → 'use client'. Overview/Mer stay Links.
'use client'
import Link from 'next/link'
import styles from './redesign.module.css'

export default function MobileNav({ active, clientId }: { active: string; clientId?: string }) {
  const withClient = (href: string) => (clientId ? `${href}?clientId=${clientId}` : href)
  return (
    <nav className={styles.bottomBar}>
      <Link href={withClient('/dashboard-next')} className={`${styles.barItem} ${active === 'overview' ? styles.barActive : ''}`}>
        <i className="ti ti-layout-dashboard" /><span>Overview</span>
      </Link>
      <button
        type="button"
        className={`${styles.barItem} ${active === 'lora' ? styles.barActive : ''}`}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        onClick={() => window.dispatchEvent(new Event('loramer:open-chat'))}
      >
        <i className="ti ti-sparkles" /><span>Lora</span>
      </button>
      <Link href={withClient('/dashboard-next/mer')} className={`${styles.barItem} ${active === 'mer' ? styles.barActive : ''}`}>
        <i className="ti ti-atom" /><span>Mer</span>
      </Link>
    </nav>
  )
}
