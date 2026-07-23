'use client'
// LORAMER_ECOM_MONEY_SURFACE_DISPLAY_V1 / LORAMER_NEXT_MONEY_CARD_V1 — -NEXT-ONLY full money-surface waterfall.
// Reads /api/next/money and renders the per-platform chain ORDERED BY moneyBasis (Woo net incl shipping/tax;
// Shopify excl — never hardcoded). Residual line shows ONLY when != 0. True 0 -> "$0.00"; absent -> "— not
// captured", never a false $0. Purely additive; the frozen reviewer path never imports it.
//   WINDOW: pass RESOLVED start+end (from the card engine's shared date picker) → the card obeys the global range.
//   Falls back to `period` (the standalone store page passes a preset). `bare` = render inside a grid card (the
//   grid Card supplies the outer chrome + title), so no own card wrapper/title.
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
  incompleteNote?: string // LORAMER_QUERY_COMPLETENESS_V1 slice 3 — stale-tail/partial caption (server-built)
}

const PLATFORM_LABEL: Record<string, string> = { woocommerce: 'WooCommerce', shopify: 'Shopify' }

export default function MoneyWaterfall({
  clientId, platform, period, start, end, bare = false,
}: { clientId: string; platform?: string; period?: string; start?: string; end?: string; bare?: boolean }) {
  const [data, setData] = useState<MoneyData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    const qs = new URLSearchParams({ clientId })
    // RESOLVED window from the shared picker takes precedence; else the preset period (standalone page).
    if (start && end) { qs.set('start', start); qs.set('end', end) }
    else qs.set('period', period || 'LAST_30_DAYS')
    if (platform) qs.set('platform', platform)
    fetch(`/api/next/money?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setData(d); setState('ready') } })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [clientId, platform, period, start, end])

  const wrap = (inner: React.ReactNode) => (bare ? <div className={styles.bareWrap}>{inner}</div> : <div className={styles.card}>{inner}</div>)

  if (state === 'loading') return wrap(<div className={styles.loading}>Loading money breakdown…</div>)
  if (state === 'error' || !data) return wrap(<div className={styles.empty}>Couldn’t load the money breakdown.</div>)
  if (!data.hasStoreMoney) return wrap(<div className={styles.empty}>No store (Shopify / WooCommerce) money captured for this client yet.</div>)

  const label = PLATFORM_LABEL[data.platform || ''] || data.platform || 'Store'
  const chain = chainForBasis(data.basis)
  const residual = data.components.residual

  const inner = (
    <>
      {/* In bare (in-grid) mode the grid Card already shows the title → show only the platform + range sub-line. */}
      {bare ? (
        <div className={styles.sub} style={{ marginBottom: 6 }}>{label} · {data.current.startDate} → {data.current.endDate}</div>
      ) : (
        <div className={styles.header}>
          <span className={styles.title}>{label} — money breakdown</span>
          <span className={styles.sub}>{data.current.startDate} → {data.current.endDate}</span>
        </div>
      )}

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

          {/* LORAMER_QUERY_COMPLETENESS_V1 slice 3 — stale-tail/partial caption (was unwired; the screenshot found it). */}
          {data.incompleteNote ? (
            <div className={styles.coverage} style={{ color: '#b45309', overflowWrap: 'anywhere' }}>⚠ {data.incompleteNote}</div>
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
    </>
  )

  return wrap(inner)
}
