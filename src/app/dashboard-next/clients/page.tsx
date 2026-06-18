// LORAMER_REDESIGN_INCB — the Multi-Client Overview (agency portfolio landing), where "All clients" lands.
// Guard-first (requirePreviewUser as the FIRST line, same isolation pattern as every /dashboard-next page):
// a non-allowlisted request redirects to /dashboard BEFORE any content is computed. Static first pass —
// real client/connection data + proactive-Lora intelligence land in the next two increments.
import { requirePreviewUser } from '@/lib/preview-gate'
import Shell from '@/components/redesign/Shell'
import MultiClientOverview from '@/components/redesign/MultiClientOverview'

export default async function DashboardNextClientsPage() {
  await requirePreviewUser()
  return (
    <Shell active="clients">
      <MultiClientOverview />
    </Shell>
  )
}
