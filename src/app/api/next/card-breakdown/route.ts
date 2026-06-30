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

  const result = await queryBreakdown({
    clientId,
    breakdownType: sp.get('breakdownType') || '',
    baseRange: sp.get('period') || 'LAST_30_DAYS',
    rankBy: sp.get('rankBy') || 'spend',
    topN: Math.max(1, Math.min(50, Number(sp.get('topN')) || 8)),
  })

  return NextResponse.json({
    breakdownType: result.breakdownType,
    window: result.window,
    rows: result.rows,
    note: result.note || null,
  })
}
