// LORAMER_REDESIGN_INCA — the unified, full-width top bar. ONE shared component, responsive (no desktop/
// mobile fork): the same markup renders for both; CSS swaps the desktop "All clients" home control for a
// mobile hamburger. Owns all top-bar interactivity (the mobile drawer + scrim, the client-switcher dropdown,
// and the account menu) → 'use client'. Content that doesn't need state (the drawer body = RailContent) is
// passed in as a prop so it stays server-rendered. Isolation is unaffected — the page guards first, so none
// of this renders for non-allowlisted users.
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import styles from './redesign.module.css'
import Avatar from './Avatar'

export default function TopBar({
  clientName,
  clientId = null,
  agencyName = 'Russ Côté',
  clientLogoUrl = null,
  agencyLogoUrl = null,
  drawer,
}: {
  clientName: string
  clientId?: string | null
  agencyName?: string
  clientLogoUrl?: string | null
  agencyLogoUrl?: string | null
  drawer: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

  // LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 — real, membership-aware client list from /api/next/clients.
  // Selecting: on a per-client page keep the current view and swap the client (change WHO, keep WHERE); from the
  // all-clients list (no current client) route to that client's profile. Falls back to the current client until loaded/on error.
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    let alive = true
    fetch('/api/next/clients')
      .then((r) => (r.ok ? r.json() : { clients: [] }))
      .then((d) => { if (alive) setClients(d.clients || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const clientList = clients.length ? clients : [{ id: '', name: clientName }]

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          {/* Desktop: All clients home control. Mobile (CSS): hamburger that opens the drawer. */}
          <Link href="/dashboard-next/clients" className={styles.homeBtn}>
            <i className="ti ti-users" /> All clients
          </Link>
          <button className={styles.hamburger} onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <i className="ti ti-menu-2" />
          </button>

          {/* Client switcher: the avatar is its own tap target (→ client profile); the name+chevron opens the dropdown. */}
          <div className={styles.tbSwitcher}>
            <Link href={clientId ? `/dashboard-next/client-profile?clientId=${clientId}` : '/dashboard-next/client-profile'} className={styles.tbAvatarLink} aria-label="Client profile">
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
                  {clientList.map((c) => (
                    <button
                      key={c.id || c.name}
                      className={styles.menuItem}
                      onClick={() => {
                        setSwitcherOpen(false)
                        // LORAMER_NEXT_SWITCHER_LIST_NAV_V1 — Change WHO: on a per-client page KEEP WHERE (a current client
                        // exists → swap it on the same view, unchanged); from the all-clients list (no current client →
                        // clientId is null) route to that client's PROFILE — the same target as the cards
                        // (MultiClientOverview.tsx:327) and the switcher's own avatar (TopBar.tsx:63). clientId (what Shell
                        // passes down) is the "is there a current client?" signal, so no route-name string check is needed.
                        if (c.id) router.push(clientId ? `${pathname}?clientId=${c.id}` : `/dashboard-next/client-profile?clientId=${c.id}`)
                      }}
                    >
                      <Avatar name={c.name} kind="client" />
                      <span className={styles.tbNameLabel}>{c.name}</span>
                      {c.name === clientName && <i className={`ti ti-check ${styles.menuCheck}`} />}
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
                <Link href="/billing" className={styles.menuItem} onClick={() => setAcctOpen(false)}><i className="ti ti-credit-card" /> Billing</Link>
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
        onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) setDrawerOpen(false) }} /* LORAMER_NEXT_RAIL_LORA_TRIGGER_V1 — the Lora rail entry is now a <button> (dispatches open-chat, no nav), so close the drawer on button taps too, not just links */
      >
        <button className={styles.closeBtn} onClick={() => setDrawerOpen(false)} aria-label="Close menu">
          <i className="ti ti-x" />
        </button>
        {drawer}
      </div>
    </>
  )
}
