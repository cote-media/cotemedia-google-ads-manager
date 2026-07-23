// LORAMER_NEXT_ROAS_CARD_V1 — owner-gated multi-source ROAS read for the -next card engine. resolveAccess verifies
// the VIEWER may see this client; the DATA is the owner's client (queryRoasBases by clientId). STANDALONE read —
// does NOT touch queryBreakdown (shared/live read-path). Reads the captured system-of-record only; writes nothing;
// touches no shared/reviewer file → reviewer path byte-identical. Additive, -next-only.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccess } from '@/lib/access/can-access'
import { resolveCardWindows } from '@/lib/next/card-windows'
import { queryRoasBases } from '@/lib/next/roas-bases'
import { getCoverageForWindows } from '@/lib/next/coverage' // LORAMER_QUERY_COMPLETENESS_V1 slice 2
import { annotateContribution, buildIncompleteNote } from '@/lib/next/query-completeness' // LORAMER_QUERY_COMPLETENESS_V1 slice 2

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // 404, don't confirm the id

  // Resolve the window exactly like every other card (shared resolver — Lesson 19). Explicit start/end from the
  // engine's global/override range; else the preset. Compare not applied (v1 ROAS card mirrors the money card).
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end')
  const period = sp.get('period') || 'LAST_30_DAYS'
  const { current } = resolveCardWindows(
    qs && qe && ISO.test(qs) && ISO.test(qe) ? { start: qs, end: qe } : { period },
  )

  const result = await queryRoasBases({ clientId, startDate: current.startDate, endDate: current.endDate })

  // LORAMER_QUERY_COMPLETENESS_V1 slice 2 — a PARTIAL ROAS is the highest-visibility false-whole-number on the
  // page; flag it when a platform's capture is failing/stale. Additive + best-effort.
  let complete: boolean | undefined
  let incompleteNote: string | undefined
  try {
    const win = [{ startDate: current.startDate, endDate: current.endDate }]
    const cov = await getCoverageForWindows(clientId, [], win)
    const comp = await annotateContribution(clientId, win, cov)
    complete = comp.overallComplete
    incompleteNote = buildIncompleteNote(comp.perWindow[0])
  } catch { /* best-effort */ }

  return NextResponse.json({ ...result, complete, incompleteNote })
}
