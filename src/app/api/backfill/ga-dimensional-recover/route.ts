// LORAMER_GA_FORWARD_DIM_LOOKBACK_V1
// EXPLICIT, one-time recovery of a forward-dim GAP for ONE client over an EXPLICIT [from..to] window (e.g. Bath
// Fitter 07-15..today, frozen by the old single-shot forward-dim). CRON_SECRET-bearer GET, and from+to are BOTH
// REQUIRED — with no defaults it cannot fire "blank". It is NOT registered in vercel.json crons, so it NEVER runs on
// deploy; it only executes when a human calls it with the secret + explicit dates. Upserts on the conflict key,
// scoped to `clientId` (touches no other client). Never touches either GA cursor and never marks anything complete.
import { NextResponse } from 'next/server'
import { recoverGaDimensionalForward } from '@/lib/backfill/ga-dimensional-backfill'

// LORAMER_TOKEN_FRESH_READ_V1 — THE SAME THREE DIRECTIVES cron/sync HAS CARRIED SINCE
// LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1, and this route needed them just as badly.
// MEASURED 2026-07-30: this route wrote a DEAD access token over a freshly re-authorized one, TWICE
// (18:00:38Z and 18:31:25Z), while /api/backfill/ga-token-diag — identical refresh code, but declaring
// force-no-store — minted five live tokens in a row against the SAME refresh token. Google was proven
// not to be the variable: three refreshes seven seconds apart returned three DIFFERENT working tokens.
// Two dead writes and five live mints, split cleanly on this declaration.
// ⚠ HONEST LIMIT, so nobody reads more into this than was proven: the correlation is exact and the
// mechanism is NOT established (Next 14 does not cache POST by default, which argues against the
// simplest reading). These directives are the cheap, known-correct posture for a route whose
// correctness depends on reading the primary fresh — not a demonstrated root cause.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : authHeader).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!clientId || !from || !to) {
    return NextResponse.json({ error: 'Missing required clientId, from, to (YYYY-MM-DD) — explicit only, no defaults' }, { status: 400 })
  }
  // LORAMER_GA_RECOVER_SUBMONTH_WINDOW_V1 — sliceDays is an OPTIONAL override, not a required knob. The writer's
  // default is sub-month because a calendar month is measurably not survivable on a heavy property; this exists so a
  // run that reports a slow maxLapMs can be re-driven finer without a deploy. The route stays thin: no budget
  // arithmetic here, because the budget must be enforced where the GA calls are issued.
  const sliceDaysRaw = searchParams.get('sliceDays')
  const sliceDays = sliceDaysRaw === null ? undefined : Number(sliceDaysRaw)
  if (sliceDays !== undefined && (!Number.isFinite(sliceDays) || sliceDays < 1 || sliceDays > 31)) {
    return NextResponse.json({ error: 'sliceDays must be an integer 1..31' }, { status: 400 })
  }
  const { status, body } = await recoverGaDimensionalForward(clientId, from, to, { sliceDays })
  return NextResponse.json(body, { status })
}
