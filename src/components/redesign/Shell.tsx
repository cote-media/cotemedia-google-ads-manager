// LORAMER_REDESIGN_INC1 — the constant app shell from docs/design/loramer_nav_concept.html.
// Server component (no client interactivity yet — drag/switcher dropdown/live data arrive in Increment 2).
// Fonts + icons load via <link> exactly as the mockup does (Instrument Sans from Google Fonts; Tabler icon
// webfont from jsdelivr). Build-dark: this only ever renders for allowlisted users (the page guards first).
import { Fragment } from 'react'
import Link from 'next/link'
import styles from './redesign.module.css'

type NavItem = { id: string; label: string; icon: string; href: string; group?: 'channel'; connect?: boolean }

// Static for Increment 1 — the per-connection Channels list becomes dynamic in a later increment.
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-layout-dashboard', href: '/dashboard-next' },
  { id: 'google-ads', label: 'Google Ads', icon: 'ti-brand-google', href: '/dashboard-next/google-ads', group: 'channel' },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'ti-brand-meta', href: '/dashboard-next/meta-ads', group: 'channel' },
  { id: 'analytics', label: 'Analytics', icon: 'ti-chart-bar', href: '/dashboard-next/analytics', group: 'channel' },
  { id: 'shopify', label: 'Shopify', icon: 'ti-brand-shopify', href: '/dashboard-next/shopify', group: 'channel' },
  { id: 'connect', label: 'Connect a source', icon: 'ti-plus', href: '/clients', group: 'channel', connect: true },
  { id: 'lora', label: 'Lora', icon: 'ti-sparkles', href: '/dashboard-next/lora' },
  { id: 'mer', label: 'Mer', icon: 'ti-microscope', href: '/dashboard-next/mer' },
]

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
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.47.0/dist/tabler-icons.min.css" />

      <aside className={styles.rail}>
        <div className={styles.wordmark}>LoraMer</div>

        <div className={styles.switcher}>
          <span className={styles.av}>{clientName.charAt(0)}</span>
          <span className={styles.switcherName}>{clientName}</span>
          <i className={`ti ti-chevron-down ${styles.chev}`} />
        </div>

        <nav className={styles.nav}>
          {NAV.map((item, i) => {
            // Channels group label sits right before the first channel item.
            const groupLabel = item.group === 'channel' && NAV[i - 1]?.group !== 'channel'
              ? <div key="grp" className={styles.navGroup}>Channels</div>
              : null
            // Separator between the channels block and Lora/Mer.
            const sep = item.id === 'lora'
              ? <div key="sep" className={styles.navSep} />
              : null
            const cls = [styles.navItem, item.id === active ? styles.active : '', item.connect ? styles.connect : '']
              .filter(Boolean)
              .join(' ')
            return (
              <Fragment key={item.id}>
                {groupLabel}
                {sep}
                <Link href={item.href} className={cls}>
                  <i className={`ti ${item.icon}`} />
                  {item.label}
                </Link>
              </Fragment>
            )
          })}
        </nav>

        <div className={styles.acct}>
          <span className={`${styles.av} ${styles.acctAv}`}>RC</span>
          <span className={styles.acctName}>Russ Côté</span>
          <i className="ti ti-settings" />
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.crumbbar}>
          <span className={styles.crumb}>{clientName} · last 14 days</span>
          <span className={styles.pill}><i className="ti ti-calendar" /> Last 14 days</span>
          <span className={styles.pill}><i className="ti ti-adjustments-horizontal" /> Customize</span>
          <span className={`${styles.pill} ${styles.pillLora}`}><i className="ti ti-sparkles" /> Ask Lora</span>
        </div>
        {children}
      </main>
    </div>
  )
}
