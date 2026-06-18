// LORAMER_REDESIGN_INCA — the unified, full-width top bar. ONE shared component, responsive (no desktop/
// mobile fork): the same markup renders for both; CSS swaps the desktop "All clients" home control for a
// mobile hamburger. Owns all top-bar interactivity (the mobile drawer + scrim, the client-switcher dropdown,
// and the account menu) → 'use client'. Content that doesn't need state (the drawer body = RailContent) is
// passed in as a prop so it stays server-rendered. Isolation is unaffected — the page guards first, so none
// of this renders for non-allowlisted users.
'use client'
import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import styles from './redesign.module.css'

// Avatar art rule: render the logo if a URL is on file, else the monogram. No logos on file yet.
function initials(name: string, max: 1 | 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (max === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + (parts[1]?.charAt(0) || '')).toUpperCase()
}
function Avatar({ name, kind, logoUrl }: { name: string; kind: 'client' | 'agency'; logoUrl?: string | null }) {
  const cls = `${styles.tbAvatar} ${kind === 'agency' ? styles.tbAvatarAgency : styles.tbAvatarClient}`
  return (
    <span className={cls}>
      {logoUrl ? <img src={logoUrl} alt="" className={styles.avatarImg} /> : initials(name, kind === 'agency' ? 2 : 1)}
    </span>
  )
}

export default function TopBar({
  clientName,
  agencyName = 'Russ Côté',
  clientLogoUrl = null,
  agencyLogoUrl = null,
  drawer,
}: {
  clientName: string
  agencyName?: string
  clientLogoUrl?: string | null
  agencyLogoUrl?: string | null
  drawer: React.ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

  // Static placeholder switch list (real client list wired in a later increment). Selecting is a no-op stub.
  const clientList = [clientName, 'Foam OH', 'Influential Drones']

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          {/* Desktop: All clients home control. Mobile (CSS): hamburger that opens the drawer. */}
          <Link href="/dashboard-next/clients" className={styles.homeBtn}>
            <i className="ti ti-layout-grid" /> All clients
          </Link>
          <button className={styles.hamburger} onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <i className="ti ti-menu-2" />
          </button>

          {/* Client switcher: the avatar is its own tap target (→ client profile); the name+chevron opens the dropdown. */}
          <div className={styles.tbSwitcher}>
            <Link href="/dashboard-next/client-profile" className={styles.tbAvatarLink} aria-label="Client profile">
              <Avatar name={clientName} kind="client" logoUrl={clientLogoUrl} />
            </Link>
            <button className={styles.tbName} onClick={() => setSwitcherOpen((v) => !v)}>
              <span className={styles.tbNameLabel}>{clientName}</span>
              <i className="ti ti-chevron-down" />
            </button>
            {switcherOpen && (
              <>
                <div className={styles.menuBackdrop} onClick={() => setSwitcherOpen(false)} />
                <div className={`${styles.menu} ${styles.menuLeft}`}>
                  <div className={styles.menuLabel}>Switch client</div>
                  {clientList.map((name, i) => (
                    <button key={i} className={styles.menuItem} onClick={() => setSwitcherOpen(false)}>
                      <Avatar name={name} kind="client" />
                      <span className={styles.tbNameLabel}>{name}</span>
                      {name === clientName && <i className={`ti ti-check ${styles.menuCheck}`} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Account: agency avatar → account menu. */}
        <div className={styles.topRight}>
          <button className={styles.acctAvatarBtn} onClick={() => setAcctOpen((v) => !v)} aria-label="Account menu">
            <Avatar name={agencyName} kind="agency" logoUrl={agencyLogoUrl} />
          </button>
          {acctOpen && (
            <>
              <div className={styles.menuBackdrop} onClick={() => setAcctOpen(false)} />
              <div className={`${styles.menu} ${styles.menuRight}`}>
                {/* Inert stubs (visible, labeled, non-navigating). */}
                <button className={styles.menuItem} onClick={() => setAcctOpen(false)}><i className="ti ti-settings" /> Agency settings</button>
                <button className={styles.menuItem} onClick={() => setAcctOpen(false)}><i className="ti ti-credit-card" /> Billing</button>
                <button className={styles.menuItem} onClick={() => setAcctOpen(false)}><i className="ti ti-shield-lock" /> Privacy</button>
                <button className={styles.menuItem} onClick={() => setAcctOpen(false)}><i className="ti ti-file-text" /> Terms</button>
                <div className={styles.menuSep} />
                {/* Wired to the app's existing sign-out. */}
                <button className={styles.menuItem} onClick={() => signOut({ callbackUrl: '/' })}><i className="ti ti-logout" /> Sign out</button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Mobile drawer (opened by the hamburger) = the rail content, passed in server-rendered. Hidden ≥ md. */}
      <div
        className={`${styles.scrim} ${drawerOpen ? styles.scrimOpen : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`${styles.drawer} ${drawerOpen ? styles.drawerOpen : ''}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setDrawerOpen(false) }}
      >
        <button className={styles.closeBtn} onClick={() => setDrawerOpen(false)} aria-label="Close menu">
          <i className="ti ti-x" />
        </button>
        {drawer}
      </div>
    </>
  )
}
