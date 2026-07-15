// LORAMER_CLIENT_METRICS_ROLLUP_V1
// LORAMER_CLIENT_METRICS_ROLLUP_V2 - honest revenue: store (shopify/woo) and
// GA both report the SAME sales, and ads conversion_value is the attributed
// slice of them — so they are never added together. Precedence: store rows
// present -> storeRev is revenue30 (source of truth); else ga rows present ->
// gaRev; else null. conversion_value is returned separately as convValue30.
//
// Session-authed per-client rollup for the /clients page cards:
//   spend30 (google+meta) / revenue30 + revenueSource / roas / convValue30
//   over LAST_30_DAYS + lastActive (true max(date), unbounded).
// Reads metrics_daily ONLY (no live platform fetch). Additive — nothing
// consumes this yet; the /clients UI wires in next.
//
// Canonical-row filter (verified against live data 2026-06-05): top-level
// rows are entity_level='account' with the EMPTY-STRING sentinel in
// breakdown_type/breakdown_value — identical to aggregateWindow in
// src/lib/metrics-query.ts, so these sums match the query layer / Ask Claude.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
// LORAMER_LORA_CANONICAL_SETTLE_V1 (Fix #1 B1) — the ONE canonical settle (store>ga>none; NEVER summed).
import { emptyRevenueAcc, settleRevenue, type RevenueAcc } from '@/lib/next/revenue-settle'

const ADS_PLATFORMS = ['google', 'meta']
const STORE_PLATFORMS = ['shopify', 'woocommerce']

type ClientRollup = {
  spend30: number
  revenue30: number | null
  revenueSource: 'store' | 'ga' | 'none'
  roas: number | null
  lastActive: string | null
  convValue30: number
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
  const buckets: Record<string, RevenueAcc> = {}
  for (const id of clientIds) {
    buckets[id] = emptyRevenueAcc()
  }

  // 30-day window from the ONE date resolver (Lesson 19).
  const { startDate, endDate } = resolveDateWindow('LAST_30_DAYS')

  // Canonical top-level rows only; paginate (Supabase caps selects at 1000).
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('metrics_daily')
      .select('client_id,platform,spend,revenue,conversion_value')
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
      const b = buckets[r.client_id as string]
      if (!b) continue
      const platform = r.platform as string
      if (ADS_PLATFORMS.includes(platform)) {
        b.spend += Number(r.spend || 0)
        b.conversionValue += Number(r.conversion_value || 0)
      } else if (STORE_PLATFORMS.includes(platform)) {
        b.storeRev += Number(r.revenue || 0)
        b.storeRows += 1
      } else if (platform === 'ga') {
        b.gaRev += Number(r.revenue || 0)
        b.gaRows += 1
      }
    }
    if (rows.length < PAGE) break
    from += PAGE
  }

  for (const id of clientIds) {
    // Canonical settle (store>ga>none, never summed; roas = revenue/spend). Field names mapped to the
    // legacy /clients rollup contract (spend30/revenue30/convValue30) — values byte-identical.
    const c = settleRevenue(buckets[id])
    metrics[id] = {
      spend30: c.spend,
      revenue30: c.revenue,
      revenueSource: c.revenueSource,
      roas: c.roas,
      lastActive: null,
      convValue30: c.conversionValue,
    }
  }

  // lastActive = true MAX(date) across ALL of the client's rows (not 30d-capped).
  // LORAMER_LATEST_DATE_ACCOUNT_GRAIN_V1 — the account-grain triple below is LOAD-BEARING, not redundant: it
  // satisfies migration 035's partial-index predicate (entity_level='account' AND breakdown_type='' AND
  // breakdown_value=''), turning this into an Index Only Scan Backward instead of scanning EVERY grain — which
  // on heavy clients exceeds the 8s live statement_timeout → 57014 → swallowed → a silent null lastActive.
  // Rests on the EMPIRICAL invariant that an account row is written on every day any grain is written
  // (verified 23/23 fleet + per client×platform, 2026-07-15; NOT schema-enforced). Do not delete as redundant.
  await Promise.all(
    clientIds.map(async id => {
      const { data } = await supabaseAdmin
        .from('metrics_daily')
        .select('date')
        .eq('client_id', id)
        .eq('entity_level', 'account')
        .eq('breakdown_type', '')
        .eq('breakdown_value', '')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.date) metrics[id].lastActive = data.date as string
    })
  )

  return NextResponse.json({ metrics })
}
