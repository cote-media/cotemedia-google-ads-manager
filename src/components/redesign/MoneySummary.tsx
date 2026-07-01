'use client'
// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — -NEXT-ONLY compact money summary for the client Overview. Shows
// Gross -> Net for the client's store platform and taps through to the full waterfall on the store drill page.
// Renders NOTHING when the client has no captured store money (no fabricated $0). Purely additive; reviewer
// path never imports it.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './money.module.css'
import { fmtMoney } from '@/lib/next/money-surface'

type Comp = { value: number | null; present: boolean; absentDays: number }
interface MoneyData {
  platform: string | null
  hasStoreMoney: boolean
  basis: string | null
  current: { startDate: string; endDate: string }
  moneyDays: number
  accountDays: number
  noDataInRange: boolean
  coverageComplete: boolean
  components: Record<string, Comp>
}

const PLATFORM_LABEL: Record<string, string> = { woocommerce: 'WooCommerce', shopify: 'Shopify' }

export default function MoneySummary({ clientId, period = 'LAST_30_DAYS' }: { clientId: string; period?: string }) {
  const [data, setData] = useState<MoneyData | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/next/money?clientId=${encodeURIComponent(clientId)}&period=${encodeURIComponent(period)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setDone(true) } })
      .catch(() => { if (alive) setDone(true) })
    return () => { alive = false }
  }, [clientId, period])

  // Render nothing until we know, and nothing at all for non-store clients (honest — never a fabricated card).
  if (!done || !data || !data.hasStoreMoney) return null

  const label = PLATFORM_LABEL[data.platform || ''] || data.platform || 'Store'
  const gross = data.components.grossSales?.value ?? null
  const net = data.components.netSales?.value ?? null
  const residual = data.components.residual
  const flagged = (residual && residual.present && residual.value !== null && residual.value !== 0) || !data.coverageComplete

  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <div className={styles.header}>
        <span className={styles.title}>{label} — sales money</span>
        <span className={styles.sub}>{data.current.startDate} → {data.current.endDate}</span>
      </div>

      <div className={styles.summary}>
        {data.noDataInRange ? (
          <div className={styles.empty}>No {label} sales in this range.</div>
        ) : (
          <>
            <div className={styles.summaryTop}>
              <div className={styles.g2n}>
                <span className={styles.gross}>{fmtMoney(gross)}</span>
                <span className={styles.arrow}>→</span>
                <span className={styles.net}>{fmtMoney(net)}</span>
                {flagged ? <span className={styles.flagDot} title="This range has an on-sale-markdown residual and/or partial money coverage — see the full breakdown." /> : null}
              </div>
              <span className={styles.summaryMeta}>gross → net{net !== null && gross !== null ? ` · ${fmtMoney(net - gross)} net of discounts, refunds & markdowns` : ''}</span>
            </div>
            <Link className={styles.link} href={`/dashboard-next/store?clientId=${encodeURIComponent(clientId)}&platform=${encodeURIComponent(data.platform || '')}`}>
              View full breakdown →
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
