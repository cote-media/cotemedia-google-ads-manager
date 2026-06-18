// LORAMER_PREVIEW_GATE_V1
// TEMPORARY placeholder. Exists only to prove the preview gate is live end-to-end; the real redesign
// shell builds here later (docs/LORAMER_REDESIGN_SPEC.md). No client logic, no real UI.
//
// requirePreviewUser() MUST be the FIRST line: it short-circuits (redirect to /dashboard) BEFORE any
// content is computed or returned, so a non-allowlisted request never has this page's RSC payload
// streamed in the redirect body. The layout gate stays as defense-in-depth.
import { requirePreviewUser } from '@/lib/preview-gate'

export default async function DashboardNextPage() {
  await requirePreviewUser()
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="text-muted font-mono text-sm">LoraMer redesign preview — gate is live.</p>
    </main>
  )
}
