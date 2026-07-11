// LORAMER_REDESIGN_INCA — the rail's inner content, shared by the desktop <aside> AND the mobile slide-in
// drawer (same nav, one source of truth). Per-client NAV only now: the client switcher + account row moved
// to the TopBar. Server component (pure markup). The container (.rail or .drawer) supplies the chrome.
import { Fragment } from 'react'
import Link from 'next/link'
import styles from './redesign.module.css'
import SignOutButton from './SignOutButton'

type NavItem = { id: string; label: string; icon: string; href: string; group?: 'channel'; connect?: boolean }

// Static for now — the per-connection Channels list becomes dynamic when real data is wired (later increment).
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-layout-dashboard', href: '/dashboard-next' },
  { id: 'google-ads', label: 'Google Ads', icon: 'ti-brand-google', href: '/dashboard-next/google-ads', group: 'channel' },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'ti-brand-meta', href: '/dashboard-next/meta-ads', group: 'channel' },
  { id: 'analytics', label: 'Analytics', icon: 'ti-chart-bar', href: '/dashboard-next/analytics', group: 'channel' },
  // LORAMER_NEXT_STORE_PAGE_V1 — ONE connection-aware "Store" entry (routes to /dashboard-next/store, which resolves
  // shopify|woo per captured data) REPLACES the separate 'shopify' interstitial. No 'woocommerce' entry — the single
  // Store entry serves both stores per detection.
  { id: 'store', label: 'Store', icon: 'ti-building-store', href: '/dashboard-next/store', group: 'channel' },
  { id: 'connect', label: 'Connect a source', icon: 'ti-plus', href: '/clients', group: 'channel', connect: true },
  { id: 'lora', label: 'Lora', icon: 'ti-sparkles', href: '/dashboard-next/lora' },
  { id: 'mer', label: 'Mer', icon: 'ti-atom', href: '/dashboard-next/mer' },
]

export default function RailContent({
  active,
  clientId,
  mobile = false,
}: {
  active: string
  clientName?: string
  clientId?: string
  mobile?: boolean
}) {
  // Per-client -next links carry the active client; the legacy 'connect' (/clients) link does not.
  const withClient = (href: string) => (clientId ? `${href}?clientId=${clientId}` : href)
  return (
    <>
      <div className={styles.wordmark}>LoraMer</div>

      {/* Drawer only: "All clients" at the top (it's not in the mobile TopBar — that has the hamburger).
          ti-users (roster glyph) — distinct from Overview's ti-layout-dashboard. */}
      {mobile && (
        <Link href="/dashboard-next/clients" className={`${styles.navItem} ${styles.allClients}`}>
          <i className="ti ti-users" /> All clients
        </Link>
      )}

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
              <Link href={item.connect ? item.href : withClient(item.href)} className={cls}>
                <i className={`ti ${item.icon}`} />
                {item.label}
              </Link>
            </Fragment>
          )
        })}
      </nav>

      {/* Rail footer — Sign out (also in the TopBar account menu). Shows in desktop rail AND mobile drawer. */}
      <SignOutButton />
    </>
  )
}
