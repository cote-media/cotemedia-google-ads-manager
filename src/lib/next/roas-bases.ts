// LORAMER_NEXT_ROAS_CARD_V1 — ISOLATED multi-source ROAS reader for the -next ROAS card. STANDALONE read: it does
// NOT touch queryBreakdown (whose action_type ROAS collapse is a shared/live read-path) — this reconstructs the
// spend-weighted Meta window ROAS from RAW per-day rows. Additive, read-only, metrics_daily only. No migration.
//
// THREE bases, each carrying an explicit BASIS sentence (a value can never masquerade as store-verified revenue —
// the value-column landmine: Meta assigns value to non-purchase actions e.g. view_content, so every number states
// what it IS):
//   A 'meta_purchase_roas'   = Σ purchase value ÷ Σ(value ÷ daily ROAS)  — spend-weighted; matches Meta Ads Manager
//   B 'value_per_meta_spend' = Σ Meta-ASSIGNED purchase value ÷ total Meta spend
//   C 'blended_store'        = store NET revenue (Shopify + Woo) ÷ total Meta spend  (GATED on a store EVER connected)
//
// PURCHASE FAMILY = omni_purchase ONLY. It is the single action_type Meta attaches purchase_roas to; the other
// purchase aliases (purchase / onsite_web_purchase / offsite_conversion.fb_pixel_purchase / web_in_store_purchase)
// are identical-value DEDUP VIEWS of the same purchase — summing them multi-counts. (Gate-A proven on Shelley Kyle,
// 2026-07-09, 90d: Σvalue 3990.17 ÷ Σ(value/roas) 1104.15 = 3.6138 ≈ 3.61.)
//
// FALSE-ZERO LAW: a missing input renders ABSENT (value:null), never a fabricated 0 — a day with null/0 ROAS is
// SKIPPED (not a zero contribution); a basis whose denominator/connection is missing is absent with a reason.
// WINDOW HONESTY: `captured` is the ACTUAL omni_purchase data span in-window (action_type back-drain lags for some
// clients), so the card labels the real captured range, not the nominal window edge.
import { supabaseAdmin } from '@/lib/supabase'

export type RoasBasis = {
  key: string
  label: string          // short card label
  basis: string          // the explicit basis sentence — what the number IS (never a bare "ROAS")
  value: number | null   // null ⇒ absent (never a fabricated 0)
  absent: boolean
  absentReason?: string
}

export type RoasBasesResult = {
  window: { start: string; end: string }            // requested (nominal) window
  captured: { start: string; end: string } | null   // ACTUAL omni_purchase data span in-window (label from THIS)
  metaConnected: boolean
  storeConnected: boolean
  metaSpend: number
  storeRev: number
  purchaseValue: number      // Meta-ASSIGNED purchase value (NOT store-verified revenue)
  attributedSpend: number    // Σ(value ÷ daily ROAS)
  purchaseDays: number
  daysKept: number
  daysSkippedNullZeroRoas: number
  bases: RoasBasis[]
}

const fin = (n: any): number => { const v = Number(n); return Number.isFinite(v) ? v : 0 }
const r2 = (n: number): number => Number(n.toFixed(2))

export async function queryRoasBases(opts: { clientId: string; startDate: string; endDate: string }): Promise<RoasBasesResult> {
  const { clientId, startDate, endDate } = opts

  // Connection truth (honest "is it connected" proxy — ANY metrics_daily row ever). Gates the FALSE-ZERO guard.
  const ever = async (pf: string): Promise<boolean> => {
    const { data } = await supabaseAdmin
      .from('metrics_daily').select('platform')
      .eq('client_id', clientId).eq('platform', pf).limit(1).maybeSingle()
    return !!data
  }
  const [metaConnected, shopifyEver, wooEver] = await Promise.all([ever('meta'), ever('shopify'), ever('woocommerce')])
  const storeConnected = shopifyEver || wooEver

  // ── Read 1: per-day omni_purchase rows (Meta, account) — the ONLY purchase_roas carrier. Skip null/0 ROAS days.
  let purchaseValue = 0, attributedSpend = 0, purchaseDays = 0, daysKept = 0, daysSkipped = 0
  let capMin: string | null = null, capMax: string | null = null
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from('metrics_daily')
        .select('date, conversion_value, extra')
        .eq('client_id', clientId).eq('platform', 'meta')
        .eq('breakdown_type', 'action_type').eq('entity_level', 'account')
        .eq('breakdown_value', 'omni_purchase')
        .gte('date', startDate).lte('date', endDate)
        .range(from, from + PAGE - 1)
      if (error) throw new Error('roas omni_purchase read failed: ' + error.message)
      const rows = data || []
      for (const row of rows as any[]) {
        purchaseDays++
        const dt = String(row.date ?? '')
        const value = fin(row.conversion_value)
        const ex = (row.extra || {}) as Record<string, unknown>
        const roas = row.extra ? Number(ex.purchase_roas) : NaN
        if (!Number.isFinite(roas) || roas <= 0) { daysSkipped++; continue } // a skipped day is NOT a zero
        purchaseValue += value
        attributedSpend += value / roas
        daysKept++
        if (capMin === null || dt < capMin) capMin = dt
        if (capMax === null || dt > capMax) capMax = dt
      }
      if (rows.length < PAGE) break
      from += PAGE
    }
  }

  // ── Read 2: account base rows → total Meta spend + store NET revenue. Byte-identical metric defs to
  //    /api/next/client-metrics/route.ts (spend=meta account base; storeRev=Σ shopify+woo revenue) — reconciles.
  let metaSpend = 0, storeRev = 0
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data, error } = await supabaseAdmin
        .from('metrics_daily')
        .select('platform, spend, revenue')
        .eq('client_id', clientId)
        .eq('entity_level', 'account').eq('breakdown_type', '').eq('breakdown_value', '')
        .in('platform', ['meta', 'shopify', 'woocommerce'])
        .gte('date', startDate).lte('date', endDate)
        .range(from, from + PAGE - 1)
      if (error) throw new Error('roas account-base read failed: ' + error.message)
      const rows = data || []
      for (const row of rows as any[]) {
        if (String(row.platform) === 'meta') metaSpend += fin(row.spend)
        else storeRev += fin(row.revenue)
      }
      if (rows.length < PAGE) break
      from += PAGE
    }
  }

  const captured = capMin && capMax ? { start: capMin, end: capMax } : null
  const hasPurchase = daysKept > 0

  const bases: RoasBasis[] = []

  // A — spend-weighted Meta window purchase ROAS (matches Meta Ads Manager).
  {
    const basis = 'Σ Meta-attributed purchase value ÷ Σ(value ÷ daily ROAS) — spend-weighted; matches Meta Ads Manager'
    if (metaConnected && hasPurchase && attributedSpend > 0) {
      bases.push({ key: 'meta_purchase_roas', label: 'Meta purchase ROAS (window)', basis, value: r2(purchaseValue / attributedSpend), absent: false })
    } else {
      bases.push({ key: 'meta_purchase_roas', label: 'Meta purchase ROAS (window)', basis, value: null, absent: true,
        absentReason: !metaConnected ? 'Meta not connected' : 'No Meta purchase ROAS reported in the captured window' })
    }
  }

  // B — Meta-ASSIGNED purchase value ÷ total Meta spend (label the value as Meta-attributed, NOT store revenue).
  {
    const basis = 'Meta-ASSIGNED purchase value ÷ total Meta spend (Meta-attributed value, NOT store-verified revenue)'
    if (metaConnected && hasPurchase && metaSpend > 0) {
      bases.push({ key: 'value_per_meta_spend', label: 'Value ÷ total Meta spend', basis, value: r2(purchaseValue / metaSpend), absent: false })
    } else {
      bases.push({ key: 'value_per_meta_spend', label: 'Value ÷ total Meta spend', basis, value: null, absent: true,
        absentReason: !metaConnected ? 'Meta not connected' : metaSpend <= 0 ? 'No Meta spend in the window' : 'No Meta purchase value captured' })
    }
  }

  // C — blended store NET revenue ÷ Meta spend. FALSE-ZERO GUARD: absent unless a store was EVER connected.
  {
    const basis = 'Store NET revenue (Shopify + WooCommerce) ÷ total Meta spend — blended store-truth, NOT Meta-attributed'
    if (storeConnected && metaSpend > 0) {
      bases.push({ key: 'blended_store', label: 'Blended store ÷ Meta spend', basis, value: r2(storeRev / metaSpend), absent: false })
    } else {
      bases.push({ key: 'blended_store', label: 'Blended store ÷ Meta spend', basis, value: null, absent: true,
        absentReason: !storeConnected ? 'No store connected' : 'No Meta spend in the window' })
    }
  }

  return {
    window: { start: startDate, end: endDate },
    captured,
    metaConnected, storeConnected,
    metaSpend: r2(metaSpend), storeRev: r2(storeRev),
    purchaseValue: r2(purchaseValue), attributedSpend: r2(attributedSpend),
    purchaseDays, daysKept, daysSkippedNullZeroRoas: daysSkipped,
    bases,
  }
}
