// LORAMER_REDESIGN_INC2 — the constant app shell, now RESPONSIVE (docs/LORAMER_REDESIGN_SPEC.md §4).
// Desktop (≥ md): persistent left rail + main, UNCHANGED from Increment 1.
// Mobile (< md): rail hidden → fixed bottom tab bar + slide-in drawer (MobileNav); a top bar inside the
//   content gives the 3 back-to-clients paths (‹ All clients crumb · client chip · drawer "All clients").
// Server component; fonts/icons load via <link> exactly as the mockup. Build-dark: renders only for
// allowlisted users (the page guards first).
import Link from 'next/link'
import styles from './redesign.module.css'
import RailContent from './RailContent'
import MobileNav from './MobileNav'

export default function Shell({
  active,
  clientName = 'The Escential Group',
  children,
}: {
  active: string
  clientName?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.root}>
      {/* Load the same families the mockup uses (no CSP in this app; matches the mockup byte-for-byte). */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.0/dist/tabler-icons.min.css" />

      {/* Desktop rail (hidden < md) */}
      <aside className={`${styles.rail} ${styles.railDesktop}`}>
        <RailContent active={active} clientName={clientName} />
      </aside>

      <main className={styles.main}>
        {/* Mobile top bar (hidden ≥ md): back-to-clients crumb + client chip + Ask Lora */}
        <div className={styles.mobileTop}>
          <Link href="/clients" className={styles.backCrumb}><i className="ti ti-chevron-left" /> All clients</Link>
          <Link href="/clients" className={styles.chip}>
            <span className={styles.avSm}>{clientName.charAt(0)}</span>
            <span className={styles.chipName}>{clientName}</span>
            <i className="ti ti-chevron-down" />
          </Link>
          <Link href="/dashboard-next/lora" className={`${styles.pill} ${styles.pillLora} ${styles.askMobile}`}>
            <i className="ti ti-sparkles" /> Ask Lora
          </Link>
        </div>

        {/* Desktop crumbbar (hidden < md) */}
        <div className={`${styles.crumbbar} ${styles.crumbbarDesktop}`}>
          <span className={styles.crumb}>{clientName} · last 14 days</span>
          <span className={styles.pill}><i className="ti ti-calendar" /> Last 14 days</span>
          <span className={styles.pill}><i className="ti ti-adjustments-horizontal" /> Customize</span>
          <span className={`${styles.pill} ${styles.pillLora}`}><i className="ti ti-sparkles" /> Ask Lora</span>
        </div>

        {children}
      </main>

      {/* Mobile bottom bar + drawer (hidden ≥ md). Drawer body = the same RailContent. */}
      <MobileNav active={active} drawer={<RailContent active={active} clientName={clientName} mobile />} />
    </div>
  )
}
