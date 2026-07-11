// LORAMER_NEXT_ENTITIES_V1 — captured entity-hierarchy read for the -next platform DRILL spine (Flight 1, incr 1).
// resolveAccess gates the VIEWER (owner via clients.user_email + member via client_members; FAIL-CLOSED); the DATA
// is the owner's client, read by clientId (metrics_daily is client_id-keyed — the ownerEmail keystone applies to
// owner-KEYED tables, not this one; access to the clientId is what resolveAccess proves). Reads CAPTURED metrics_daily
// base rows only — NO live platform call. Mirrors the /api/next/card-breakdown gate/param/response pattern.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAccess } from '@/lib/access/can-access'
import { queryEntities } from '@/lib/metrics-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const PLATFORMS = new Set(['google', 'meta'])
const LEVELS = new Set(['campaign', 'ad_group', 'ad_set', 'ad'])

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // 404, don't confirm the id

  const platform = sp.get('platform') || ''
  const level = sp.get('level') || ''
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: 'platform must be google or meta' }, { status: 400 })
  if (!LEVELS.has(level)) return NextResponse.json({ error: 'level must be campaign|ad_group|ad_set|ad' }, { status: 400 })
  const parentId = sp.get('parentId') || undefined

  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end')
  const period = sp.get('period') || 'LAST_30_DAYS'
  const hasWin = !!(qs && qe && ISO.test(qs) && ISO.test(qe))

  const result = await queryEntities({
    clientId, platform, level, parentEntityId: parentId,
    ...(hasWin ? { startDate: qs!, endDate: qe! } : { baseRange: period }),
  })

  return NextResponse.json(result)
}
