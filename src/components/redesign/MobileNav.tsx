// LORAMER_REDESIGN_INC2 — the ONLY client component in the redesign so far. Owns the mobile bottom tab bar
// [Overview · Lora · Mer · Menu] + the slide-in drawer (open/close + scrim). Content stays server-rendered:
// the drawer body (RailContent) is passed in as a prop, so this only adds interactivity. Hidden on desktop
// via CSS (the bar/drawer/scrim are display:none ≥ md). Isolation is unaffected — the page guards first, so
// this never renders for non-allowlisted users.
'use client'
import { useState } from 'react'
import Link from 'next/link'
import styles from './redesign.module.css'

export default function MobileNav({ active, drawer }: { active: string; drawer: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        className={`${styles.scrim} ${open ? styles.scrimOpen : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer = the rail content. Tapping any link inside dismisses it (event delegation, keeps body server-rendered). */}
      <div
        className={`${styles.drawer} ${open ? styles.drawerOpen : ''}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false) }}
      >
        <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close menu">
          <i className="ti ti-x" />
        </button>
        {drawer}
      </div>

      <nav className={styles.bottomBar}>
        <Link href="/dashboard-next" className={`${styles.barItem} ${active === 'overview' ? styles.barActive : ''}`}>
          <i className="ti ti-layout-dashboard" /><span>Overview</span>
        </Link>
        <Link href="/dashboard-next/lora" className={`${styles.barItem} ${active === 'lora' ? styles.barActive : ''}`}>
          <i className="ti ti-sparkles" /><span>Lora</span>
        </Link>
        <Link href="/dashboard-next/mer" className={`${styles.barItem} ${active === 'mer' ? styles.barActive : ''}`}>
          <i className="ti ti-atom" /><span>Mer</span>
        </Link>
        <button className={`${styles.barItem} ${open ? styles.barActive : ''}`} onClick={() => setOpen(true)}>
          <i className="ti ti-menu-2" /><span>Menu</span>
        </button>
      </nav>
    </>
  )
}
