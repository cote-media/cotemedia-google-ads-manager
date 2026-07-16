// LORAMER_RBAC_INVITE_V1 — the -next Team page. Guard-first (requirePreviewUser as the FIRST line → non-allowlisted
// redirects to /dashboard before any content). Org-level surface: mounts <TeamPanel/>, which fetches /api/org/team
// (owner/admin only) and drives invite/revoke. Resolves the caller's first accessible client only to give the Shell
// (switcher + Ask-Lora) a client context; the Team surface itself is org-scoped, not client-scoped.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveShellClient } from '@/lib/next/shell-client' // LORAMER_SHELL_CLIENT_CONTEXT_V1 — the ONE client-context resolver
import Shell from '@/components/redesign/Shell'
import TeamPanel from '@/components/redesign/TeamPanel'

export const dynamic = 'force-dynamic'

export default async function DashboardNextTeamPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  // LORAMER_SHELL_CLIENT_CONTEXT_V1 — FIXES THE LIVE WRONG-CLIENT BUG. This page used to resolve
  // `const first = (clients||[])[0]` — the FIRST accessible client by created_at — and never read searchParams at
  // all: it was the ONLY Shell-mounting client-context page that didn't. So the header showed one client while the
  // URL said another, and Shell handed ChatLauncher the WRONG clientId → Ask-Lora on Team answered about a client
  // the user was not looking at. PROVEN in prod: the 2026-07-15 23:28:38 spend row carries Ennis
  // (1b7b073f-6f21-4850-b8e3-fdd061b91fc2) while the URL said Veterinary (f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2).
  // The switcher was never inert — TopBar.tsx:82 updated the URL and this page recomputed `first`, so it snapped back.
  // Team's OWN data stays ORG-scoped (TeamPanel fetches /api/org/team, no clientId); the resolved client exists only
  // to give the Shell (switcher + Ask-Lora + rail links) a truthful context.
  const { client: resolved } = await resolveShellClient(email, searchParams)

  return (
    <Shell active="team" clientName={resolved?.name} clientId={resolved?.id}>
      <TeamPanel />
    </Shell>
  )
}
