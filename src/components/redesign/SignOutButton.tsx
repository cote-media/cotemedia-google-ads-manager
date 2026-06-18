// LORAMER_REDESIGN_POLISH — rail-footer Sign out. Reuses the app's existing next-auth signOut (same as the
// TopBar account menu — Sign out lives in BOTH places). Rendered by RailContent, so it appears in the desktop
// rail AND the mobile drawer. (No admin gear yet — that lands with RBAC.)
'use client'
import { signOut } from 'next-auth/react'
import styles from './redesign.module.css'

export default function SignOutButton() {
  return (
    <button className={styles.signOut} onClick={() => signOut({ callbackUrl: '/' })}>
      <i className="ti ti-logout" /> Sign out
    </button>
  )
}
