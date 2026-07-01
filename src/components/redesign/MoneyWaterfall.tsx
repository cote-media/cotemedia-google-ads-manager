'use client'
// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 — -NEXT-ONLY full money-surface waterfall. Reads /api/next/money and
// renders the per-platform chain ORDERED BY moneyBasis (Woo net incl shipping/tax; Shopify excl — never
// hardcoded). Residual line shows ONLY when != 0. A true 0 renders "$0.00"; an absent component renders
// "— not captured", never a false $0. Purely additive component; the frozen reviewer path never imports it.
import { useEffect, useState } from 'react'
import styles from './money.module.css'
import { chainForBasis, stepDisplayValue, fmtMoney, RESIDUAL_STEP, type ChainStep } from '@/lib/next/money-surface'

type Comp = { value: number | null; present: boolean; absentDays: number }
interface MoneyData {
  platform: string | null
  hasStoreMoney: boolean
  availablePlatforms: string[]
  multiStore?: boolean
  basis: string | null
  current: { startDate: string; endDate: string }
  accountDays: number
  moneyDays: number
  saleDaysMissingMoney: number
  noDataInRange: boolean
  coverageComplete: boolean
  components: Record<string, Comp>
  latestCapturedDate: string | null
}

const PLATFORM_LABEL: Record<string, string> = { woocommerce: 'WooCommerce', shopify: 'Shopify' }

export default function MoneyWaterfall({ clientId, platform, period = 'LAST_30_DAYS' }: { clientId: string; platform?: string; period?: string }) {
  const [data, setData] = useState<MoneyData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    const qs = new URLSearchParams({ clientId, period })
    if (platform) qs.set('platform', platform)
    fetch(`/api/next/money?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setState('ready') } })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [clientId, platform, period])

  if (state === 'loading') return <div className={styles.card}><div className={styles.loading}>Loading money breakdown…</div></div>
  if (state === 'error' || !data) return <div className={styles.card}><div className={styles.empty}>Couldn’t load the money breakdown.</div></div>
  if (!data.hasStoreMoney) return <div className={styles.card}><div className={styles.empty}>No store (Shopify / WooCommerce) money captured for this client yet.</div></div>

  const label = PLATFORM_LABEL[data.platform || ''] || data.platform || 'Store'
  const chain = chainForBasis(data.basis)
  const residual = data.components.residual

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{label} — money breakdown</span>
        <span className={styles.sub}>{data.current.startDate} → {data.current.endDate}</span>
      </div>

      {data.noDataInRange ? (
        <div className={styles.empty}>No {label} sales in this range.</div>
      ) : (
        <>
          <div className={styles.wf}>
            {chain.map((step: ChainStep) => {
              const comp = data.components[step.key] as Comp | undefined
              const value = comp ? comp.value : null
              const disp = stepDisplayValue(step, value)
              const isTotal = step.op === '='
              const rowCls = [styles.row, isTotal ? styles.totalRow : '', step.key === 'netSales' ? styles.netRow : ''].filter(Boolean).join(' ')
              const valCls = [
                styles.value,
                value === null ? styles.muted : isTotal ? '' : step.op === '-' ? styles.subtract : disp !== null && disp < 0 ? styles.subtract : styles.add,
              ].filter(Boolean).join(' ')
              return (
                <div key={step.key} className={rowCls}>
                  <span className={styles.label}>
                    {step.label}
                    {step.tooltip ? <span className={styles.info} title={step.tooltip}>ⓘ</span> : null}
                    {value === null && comp && comp.absentDays > 0 ? <span className={styles.sub}> ({comp.absentDays}d absent)</span> : null}
                  </span>
                  <span className={valCls}>{fmtMoney(disp)}</span>
                </div>
              )
            })}
          </div>

          {/* Residual = on-sale-markdown reconciliation note. Shown ONLY when captured AND non-zero. */}
          {residual && residual.present && residual.value !== null && residual.value !== 0 ? (
            <div className={styles.residual}>
              <span className={styles.label}>
                {RESIDUAL_STEP.label}
                <span className={styles.info} title={RESIDUAL_STEP.tooltip}>ⓘ</span>
              </span>
              <span className={styles.value}>{fmtMoney(residual.value)}</span>
            </div>
          ) : null}

          {!data.coverageComplete && data.saleDaysMissingMoney > 0 ? (
            <div className={styles.coverage}>
              Money is missing for {data.saleDaysMissingMoney} sale-day{data.saleDaysMissingMoney === 1 ? '' : 's'} in this range — they predate the money back-drain. (No-sale days are excluded, not missing.)
            </div>
          ) : null}

          {data.basis === 'woo_total_incl_shipping_tax_refundNetted' ? (
            <div className={styles.basisNote}>WooCommerce basis: net sales include shipping and tax, after refunds.</div>
          ) : data.basis === 'shopify_current_refundAdjusted' ? (
            <div className={styles.basisNote}>Shopify basis: net sales exclude shipping and tax, after refunds.</div>
          ) : null}

          {data.multiStore ? (
            <div className={styles.basisNote}>This client has more than one store platform — showing {label}.</div>
          ) : null}
        </>
      )}
    </div>
  )
}
