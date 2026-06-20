// LORAMER_REDESIGN_INCA — the mobile bottom tab bar (Overview · Lora · Mer). Hidden ≥ md via CSS.
// The drawer + its trigger now live in the TopBar (hamburger), so this is stateless → server component.
// Active tab keeps the accent color (from the `active` prop).
import Link from 'next/link'
import styles from './redesign.module.css'

export default function MobileNav({ active, clientId }: { active: string; clientId?: string }) {
  const withClient = (href: string) => (clientId ? `${href}?clientId=${clientId}` : href)
  return (
    <nav className={styles.bottomBar}>
      <Link href={withClient('/dashboard-next')} className={`${styles.barItem} ${active === 'overview' ? styles.barActive : ''}`}>
        <i className="ti ti-layout-dashboard" /><span>Overview</span>
      </Link>
      <Link href={withClient('/dashboard-next/lora')} className={`${styles.barItem} ${active === 'lora' ? styles.barActive : ''}`}>
        <i className="ti ti-sparkles" /><span>Lora</span>
      </Link>
      <Link href={withClient('/dashboard-next/mer')} className={`${styles.barItem} ${active === 'mer' ? styles.barActive : ''}`}>
        <i className="ti ti-atom" /><span>Mer</span>
      </Link>
    </nav>
  )
}
