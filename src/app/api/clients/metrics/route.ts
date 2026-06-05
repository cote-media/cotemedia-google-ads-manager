// LORAMER_CLIENT_METRICS_ROLLUP_V1
// Session-authed per-client rollup for the /clients page cards:
//   spend30 / revenue30 / roas over LAST_30_DAYS + lastActive (true max(date)).
// Reads metrics_daily ONLY (no live platform fetch). Additive — nothing
// consumes this yet; the /clients UI wires in next.
//
// Canonical-row filter (verified against live data 2026-06-05): top-level
// rows are entity_level='account' with the EMPTY-STRING sentinel in
// breakdown_type/breakdown_value — identical to aggregateWindow in
// src/lib/metrics-query.ts, so these sums match the query layer / Ask Claude.
//
// Revenue semantics (mirrors the dashboard): ads rows carry value in
// conversion_value (revenue written as 0 by the builders); commerce/GA rows
// carry value in revenue (no conversion_value). The fields partition cleanly,
// so revenue30 = SUM(revenue) + SUM(conversion_value) — the same combination
// the dashboard surfaces (ads ROAS = conversion_value/spend; store revenue =
// revenue). NOTE: a client with BOTH Shopify/Woo AND GA connected will count
// store revenue from each platform that reports it (platform-level overlap,
// same as summing those dashboard tabs); acceptable for the card rollup.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'

type ClientRollup = {
  spend30: number
  revenue30: number
  roas: number | null
  lastActive: string | null
}

export async function GET() {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const email = session.user.email

  // The signed-in user's clients only (same ownership model as /api/clients).
  const { data: clientRows, error: clientsErr } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_email', email)
  if (clientsErr) {
    return NextResponse.json(
      { error: 'Failed to load clients', detail: clientsErr.message },
      { status: 500 }
    )
  }
  const clientIds = (clientRows || []).map(c => c.id as string)
  const metrics: Record<string, ClientRollup> = {}
  if (clientIds.length === 0) {
    return NextResponse.json({ metrics })
  }
  for (const id of clientIds) {
    metrics[id] = { spend30: 0, revenue30: 0, roas: null, lastActive: null }
  }

  // 30-day window from the ONE date resolver (Lesson 19).
  const { startDate, endDate } = resolveDateWindow('LAST_30_DAYS')

  // Canonical top-level rows only; paginate (Supabase caps selects at 1000).
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('client_id,spend,revenue,conversion_value')
      .in('client_id', clientIds)
      .eq('entity_level', 'account')
      .eq('breakdown_type', '')
      .eq('breakdown_value', '')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (error) {
      return NextResponse.json(
        { error: 'metrics_daily query failed', detail: error.message },
        { status: 500 }
      )
    }
    const rows = data || []
    for (const r of rows) {
      const m = metrics[r.client_id as string]
      if (!m) continue
      m.spend30 += Number(r.spend || 0)
      m.revenue30 += Number(r.revenue || 0) + Number(r.conversion_value || 0)
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  // lastActive = true MAX(date) across ALL of the client's rows (not 30d-capped).
  await Promise.all(
    clientIds.map(async id => {
      const { data } = await supabaseAdmin
        .from('metrics_daily')
        .select('date')
        .eq('client_id', id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.date) metrics[id].lastActive = data.date as string
    })
  )

  for (const id of clientIds) {
    const m = metrics[id]
    m.spend30 = Number(m.spend30.toFixed(2))
    m.revenue30 = Number(m.revenue30.toFixed(2))
    m.roas = m.spend30 > 0 ? Number((m.revenue30 / m.spend30).toFixed(2)) : null
  }

  return NextResponse.json({ metrics })
}
