// LORAMER_REDESIGN_INCB — shared avatar helper (extracted from TopBar so the TopBar and the Multi-Client
// Overview cards share ONE implementation). Avatar art rule: render the logo if a URL is on file, else the
// monogram (client = first letter, agency = two initials). Server-safe (pure presentational, no hooks).
import styles from './redesign.module.css'

export function initials(name: string, max: 1 | 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (max === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + (parts[1]?.charAt(0) || '')).toUpperCase()
}

export default function Avatar({
  name,
  kind,
  logoUrl,
  className,
}: {
  name: string
  kind: 'client' | 'agency'
  logoUrl?: string | null
  className?: string
}) {
  const cls = [styles.tbAvatar, kind === 'agency' ? styles.tbAvatarAgency : styles.tbAvatarClient, className || '']
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls}>
      {logoUrl ? <img src={logoUrl} alt="" className={styles.avatarImg} /> : initials(name, kind === 'agency' ? 2 : 1)}
    </span>
  )
}
