// LORAMER_RBAC_INVITE_V1 — the -next Team page. Guard-first (requirePreviewUser as the FIRST line → non-allowlisted
// redirects to /dashboard before any content). Org-level surface: mounts <TeamPanel/>, which fetches /api/org/team
// (owner/admin only) and drives invite/revoke. Resolves the caller's first accessible client only to give the Shell
// (switcher + Ask-Lora) a client context; the Team surface itself is org-scoped, not client-scoped.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccessibleClients } from '@/lib/access/can-access'
import Shell from '@/components/redesign/Shell'
import TeamPanel from '@/components/redesign/TeamPanel'

export const dynamic = 'force-dynamic'

export default async function DashboardNextTeamPage() {
  await requirePreviewUser()

  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const ids = await listAccessibleClients(email)
  const { data: clients } = ids.length
    ? await supabaseAdmin.from('clients').select('id, name').in('id', ids).order('created_at', { ascending: true })
    : { data: [] as { id: string; name: string }[] }
  const first = (clients || [])[0] || null

  return (
    <Shell active="team" clientName={first?.name} clientId={first?.id}>
      <TeamPanel />
    </Shell>
  )
}
