// LORAMER_REDESIGN_INC2 — the rail's inner content, shared by the desktop <aside> AND the mobile slide-in
// drawer (same nav, one source of truth). Server component (pure markup). The container (.rail or .drawer)
// supplies the chrome (width / background / padding / full-height flex column); this renders the items.
import { Fragment } from 'react'
import Link from 'next/link'
import styles from './redesign.module.css'

type NavItem = { id: string; label: string; icon: string; href: string; group?: 'channel'; connect?: boolean }

// Static for now — the per-connection Channels list becomes dynamic when real data is wired (Increment 3).
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-layout-dashboard', href: '/dashboard-next' },
  { id: 'google-ads', label: 'Google Ads', icon: 'ti-brand-google', href: '/dashboard-next/google-ads', group: 'channel' },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'ti-brand-meta', href: '/dashboard-next/meta-ads', group: 'channel' },
  { id: 'analytics', label: 'Analytics', icon: 'ti-chart-bar', href: '/dashboard-next/analytics', group: 'channel' },
  { id: 'shopify', label: 'Shopify', icon: 'ti-brand-shopify', href: '/dashboard-next/shopify', group: 'channel' },
  { id: 'connect', label: 'Connect a source', icon: 'ti-plus', href: '/clients', group: 'channel', connect: true },
  { id: 'lora', label: 'Lora', icon: 'ti-sparkles', href: '/dashboard-next/lora' },
  { id: 'mer', label: 'Mer', icon: 'ti-atom', href: '/dashboard-next/mer' },
]

export default function RailContent({
  active,
  clientName,
  mobile = false,
}: {
  active: string
  clientName: string
  mobile?: boolean
}) {
  return (
    <>
      <div className={styles.wordmark}>LoraMer</div>

      {/* Drawer only: explicit "All clients" entry (back-to-clients path #3). */}
      {mobile && (
        <Link href="/clients" className={`${styles.navItem} ${styles.allClients}`}>
          <i className="ti ti-arrow-left" /> All clients
        </Link>
      )}

      <div className={styles.switcher}>
        <span className={styles.av}>{clientName.charAt(0)}</span>
        <span className={styles.switcherName}>{clientName}</span>
        <i className={`ti ti-chevron-down ${styles.chev}`} />
      </div>

      <nav className={styles.nav}>
        {NAV.map((item, i) => {
          const groupLabel = item.group === 'channel' && NAV[i - 1]?.group !== 'channel'
            ? <div key="grp" className={styles.navGroup}>Channels</div>
            : null
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
    </>
  )
}
