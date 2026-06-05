// LORAMER_GA_METRICS_ROW_V1
// Single source of truth for the GA daily metrics_daily row shape. Imported by
// BOTH the forward-capture cron (src/app/api/cron/sync/route.ts) and the GA
// backfill adapter, so backfilled rows are byte-identical to forward-captured
// rows (same columns, same conflict key). Extracted verbatim from cron/sync.
import type { IntelligenceGa } from './intelligence-types'

// The subset of IntelligenceGa fields a daily row needs. Both the full
// IntelligenceGa (forward-capture) and a per-day GaDailySlice (backfill) satisfy
// this, so one builder serves both paths without an unsafe cast.
type GaMetricsInput = Pick<
  IntelligenceGa,
  | 'conversions'
  | 'totalRevenue'
  | 'sessions'
  | 'totalUsers'
  | 'newUsers'
  | 'engagementRate'
  | 'transactions'
  | 'cartToPurchaseRate'
  | 'purchaserConversionRate'
  | 'refundAmount'
>

export function gaExtra(data: GaMetricsInput): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (data.sessions != null) extra.sessions = data.sessions
  if (data.totalUsers != null) extra.totalUsers = data.totalUsers
  if (data.newUsers != null) extra.newUsers = data.newUsers
  if (data.engagementRate != null) extra.engagementRate = data.engagementRate
  if (data.transactions != null) extra.transactions = data.transactions
  if (data.cartToPurchaseRate != null) extra.cartToPurchaseRate = data.cartToPurchaseRate
  if (data.purchaserConversionRate != null) extra.purchaserConversionRate = data.purchaserConversionRate
  if (data.refundAmount != null) extra.refundAmount = data.refundAmount
  return extra
}

export function buildGaMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  propertyId: string,
  propertyName: string,
  data: GaMetricsInput
): Record<string, unknown>[] {
  return [
    {
      client_id: clientId,
      user_email: userEmail,
      platform: 'ga',
      entity_level: 'account',
      entity_id: propertyId,
      entity_name: propertyName,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      conversions: data.conversions ?? 0,
      revenue: data.totalRevenue ?? 0,
      extra: gaExtra(data),
    },
  ]
}
