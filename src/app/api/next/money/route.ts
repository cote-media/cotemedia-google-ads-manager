// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — -NEXT-ONLY money-surface data route. Sums metrics_daily.extra.money
// over (clientId, platform, window) at ACCOUNT grain, with PER-FIELD null-vs-zero (absent component -> null +
// flag, NEVER a false $0). Session + resolveAccess gated, mirroring /api/next/client-metrics. Reads captured
// system-of-record only; writes nothing; touches no shared/reviewer file -> reviewer path byte-identical.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveAccess } from '@/lib/access/can-access'
import { portfolioWindows, isPortfolioPeriod } from '@/lib/next/portfolio-windows'
import { aggregateMoney, MONEY_KEYS } from '@/lib/next/money-surface'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const STORE_PLATFORMS = ['woocommerce', 'shopify'] as const

// Most-recent money-bearing date for a store platform (scans the latest account rows). null = no money captured.
// LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — breakdown_value='' is LOAD-BEARING, not redundant: migration 035's partial
// index requires ALL THREE of entity_level='account', breakdown_type='' and breakdown_value='', so without it the
// planner cannot prove implication and the index is silently unusable. Rests on the EMPIRICAL invariant that an
// account row exists on every captured day (23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced).
// Do not delete as redundant.
async function latestMoneyDate(clientId: string, pf: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('metrics_daily')
    .select('date, extra')
    .eq('client_id', clientId).eq('platform', pf)
    .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
    .order('date', { ascending: false })
    .limit(90)
  const row = (data || []).find((r: any) => r?.extra && r.extra.money)
  return row ? (row.date as string) : null
}

export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const clientId = sp.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const access = await resolveAccess(clientId, email)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // 404, don't confirm the id

  // Which store platforms have ANY captured money (so the Summary hides for non-store clients, and multi-store
  // is surfaced honestly rather than silently picking one).
  const dates = await Promise.all(STORE_PLATFORMS.map((pf) => latestMoneyDate(clientId, pf)))
  const available = STORE_PLATFORMS.map((pf, i) => ({ pf, date: dates[i] })).filter((x) => x.date)
  const requested = sp.get('platform')
  const chosen =
    (requested && available.find((a) => a.pf === requested)?.pf) ||
    // default: the store platform with the MOST RECENT money data
    available.slice().sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]?.pf ||
    null

  if (!chosen) {
    return NextResponse.json({
      clientId, hasStoreMoney: false, availablePlatforms: [], platform: null,
      note: 'no captured store money for this client',
    })
  }

  // Window (mirror client-metrics: preset OR explicit start/end override).
  const period = isPortfolioPeriod(sp.get('period')) ? (sp.get('period') as string) : 'LAST_30_DAYS'
  const pw = portfolioWindows(period)
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const qs = sp.get('start'), qe = sp.get('end')
  const current = qs && qe && ISO.test(qs) && ISO.test(qe) ? { startDate: qs, endDate: qe } : pw.current

  // Pull the window's ACCOUNT rows for the chosen platform; collect money objs + coverage counts. COVERAGE is
  // measured against SALE-DAYS only: a no-sale day (revenue 0) legitimately has no money row (false-zero
  // discipline) and is NOT a gap. A real gap = a day that HAD sales (revenue != 0) but carries no money (predates
  // the money back-drain) — that is what we flag.
  const moneyObjs: Array<Record<string, any>> = []
  let accountDays = 0
  let saleDaysMissingMoney = 0
  let basis: string | null = null
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('date, revenue, extra')
      .eq('client_id', clientId).eq('platform', chosen)
      .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
      .gte('date', current.startDate).lte('date', current.endDate)
      .order('date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: 'metrics_daily query failed', detail: error.message }, { status: 500 })
    const rows = data || []
    for (const r of rows) {
      accountDays += 1
      const m = (r as any).extra?.money
      if (m && typeof m === 'object') {
        moneyObjs.push(m)
        if (!basis && typeof m.moneyBasis === 'string') basis = m.moneyBasis
      } else if (Number((r as any).revenue) !== 0) {
        saleDaysMissingMoney += 1 // had sales but no money → a real (pre-back-drain) gap
      }
    }
    if (rows.length < PAGE) break
  }

  const moneyDays = moneyObjs.length
  const agg = moneyDays > 0 ? aggregateMoney(moneyObjs) : null
  // components: null when the window has NO money days (honest "no data in range", not $0). Otherwise per-field agg.
  const components: Record<string, { value: number | null; present: boolean; absentDays: number }> = {}
  for (const k of MONEY_KEYS) components[k] = agg ? agg[k] : { value: null, present: false, absentDays: 0 }

  const latestOverall = available.find((a) => a.pf === chosen)?.date || null

  return NextResponse.json({
    clientId,
    platform: chosen,
    hasStoreMoney: true,
    availablePlatforms: available.map((a) => a.pf),
    multiStore: available.length > 1,
    basis,
    period, current,
    accountDays,
    moneyDays,
    saleDaysMissingMoney,
    noDataInRange: moneyDays === 0,
    // complete = every SALE day in the window carries money (no-sale days are not gaps).
    coverageComplete: moneyDays > 0 && saleDaysMissingMoney === 0,
    components,
    latestCapturedDate: latestOverall,
  })
}
