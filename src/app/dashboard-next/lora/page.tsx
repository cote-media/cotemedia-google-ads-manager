// LORAMER_LORA_PAGE_V1 — full-screen mobile Lora, server entry.
//
// ⚠ RENDERS WITHOUT <Shell>, DELIBERATELY (LORAMER_LORA_PAGE_SHELL_RESOLUTION_V1). Shell's chain kills
// document-flow scrolling: `.root` is min-height:100vh + flex column, `.main` is overflow:hidden. The
// probe-validated pattern needs the DOCUMENT to scroll, so this page cannot live inside it.
//
// NOTHING SECURITY-RELEVANT IS LOST BY THAT, because the gate was never in Shell:
//   · the preview-allowlist gate + welcome gate come from src/app/dashboard-next/layout.tsx, which
//     wraps EVERY route under /dashboard-next regardless of whether the page renders Shell
//   · requirePreviewUser() below is the same belt every sibling page wears
//   · resolveShellClient() is the same org-aware RBAC resolver every Shell page uses — it VALIDATES the
//     clientId in the URL against the caller's accessible set and falls back deterministically, so a
//     hand-typed ?clientId= for someone else's client resolves to something the caller may actually see
// What it loses is CHROME — TopBar, rail, MobileNav — which for a full-screen chat is the design.
import { requirePreviewUser } from '@/lib/preview-gate'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveShellClient } from '@/lib/next/shell-client'
import LoraPageClient from './LoraPageClient'

export default async function DashboardNextLoraPage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePreviewUser()
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || ''
  const { client: resolved } = await resolveShellClient(email, searchParams)

  return <LoraPageClient clientId={resolved?.id} clientName={resolved?.name} />
}
