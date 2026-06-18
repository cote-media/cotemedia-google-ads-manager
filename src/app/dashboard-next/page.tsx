// LORAMER_REDESIGN_INC1
// requirePreviewUser() MUST be the FIRST line: it short-circuits (redirect to /dashboard) BEFORE any
// content is computed or returned, so a non-allowlisted request never has this page's RSC payload
// streamed in the redirect body. The layout gate stays as defense-in-depth. Then render the redesign
// shell + the static Overview (Increment 1 — build-dark behind the preview gate).
import { requirePreviewUser } from '@/lib/preview-gate'
import Shell from '@/components/redesign/Shell'
import OverviewStatic from '@/components/redesign/OverviewStatic'

export default async function DashboardNextPage() {
  await requirePreviewUser()
  return (
    <Shell active="overview">
      <OverviewStatic />
    </Shell>
  )
}
