// LORAMER_REDESIGN_INCA — stub route for the client profile card (reached by tapping the client avatar).
// Guard-first (requirePreviewUser as the FIRST line, same isolation pattern as every /dashboard-next page):
// a non-allowlisted request redirects to /dashboard BEFORE any content is computed. In-redesign placeholder —
// must NOT bounce to legacy.
import Link from 'next/link'
import { requirePreviewUser } from '@/lib/preview-gate'

export default async function DashboardNextClientProfilePage() {
  await requirePreviewUser()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <p className="text-muted font-mono text-sm">Client profile — coming soon</p>
      <Link href="/dashboard-next" className="text-accent font-mono text-sm">← Overview</Link>
    </main>
  )
}
