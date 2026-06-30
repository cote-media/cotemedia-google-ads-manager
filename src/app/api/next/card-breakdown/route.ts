// LORAMER_NEXT_CARD_ENGINE_V1 — owner-gated breakdown read for the card engine. resolveAccess verifies the VIEWER
// may see this client; the DATA is the owner's client (queryBreakdown by clientId). queryBreakdown caps to the
// query-exposed allowlist + returns a `note` for unknown/not-yet-exposed families → surfaced honestly (the card
// shows the note, never fabricated data). Only the 7 currently-allowlisted families return rows today (dep #2 expands it).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccess } from '@/lib/access/can-access'
import { queryBreakdown } from '@/lib/metrics-query'

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

  const breakdownType = sp.get('breakdownType') || ''
  const rankBy = sp.get('rankBy') || 'spend'
  const topN = Math.max(1, Math.min(50, Number(sp.get('topN')) || 8))
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end'), qcs = sp.get('cmpStart'), qce = sp.get('cmpEnd')
  const period = sp.get('period') || 'LAST_30_DAYS'
  const hasWin = !!(qs && qe && ISO.test(qs) && ISO.test(qe))

  const result = await queryBreakdown({
    clientId, breakdownType, rankBy, topN,
    ...(hasWin ? { startDate: qs!, endDate: qe! } : { baseRange: period }),
  })

  // LORAMER_NEXT_CARD_ENGINE_RESHAPE_V1 — when a compare window is given, fetch it too and attach each value's
  // compare-window rankBy metric (cmpRank) so the card renders a per-row delta. WRITE-nothing; metrics_daily reads only.
  let withCmp = result.rows as any[]
  if (qcs && qce && ISO.test(qcs) && ISO.test(qce)) {
    const cmp = await queryBreakdown({ clientId, breakdownType, rankBy, topN: 50, startDate: qcs, endDate: qce })
    const cmpByValue = new Map<string, number>()
    for (const r of cmp.rows as any[]) cmpByValue.set(r.value, Number((r as any)[rankBy] ?? r.spend ?? 0))
    withCmp = result.rows.map((r: any) => ({ ...r, cmpRank: cmpByValue.get(r.value) ?? 0 }))
  }

  return NextResponse.json({
    breakdownType: result.breakdownType,
    window: result.window,
    rankBy,
    hasCompare: !!(qcs && qce),
    rows: withCmp,
    note: result.note || null,
  })
}
