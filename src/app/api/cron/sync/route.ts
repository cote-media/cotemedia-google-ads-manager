// LORAMER_FORWARD_CAPTURE_CRON_V1
// Nightly forward-capture: yesterday's Shopify metrics -> metrics_daily.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import type { IntelligenceShopify } from '@/lib/intelligence/intelligence-types'

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

type PlatformConnection = {
  platform: string
  account_id: string
  account_name?: string | null
  user_email?: string | null
}

type ClientRow = {
  id: string
  user_email: string
  platform_connections?: PlatformConnection[]
}

type SyncError = {
  clientId: string
  platform: string
  message: string
}

function shopifyAccountExtra(data: IntelligenceShopify): Record<string, unknown> {
  return {
    avgOrderValue: data.avgOrderValue,
    refundedAmount: data.refundedAmount,
    newCustomers: data.newCustomers,
    returningCustomers: data.returningCustomers,
    refundedOrderCount: data.refundedOrderCount,
    refundRate: data.refundRate,
    returningRate: data.returningRate,
    newCustomerAov: data.newCustomerAov,
    returningCustomerAov: data.returningCustomerAov,
    revenueConcentration: data.revenueConcentration,
    abandonedCheckoutCount: data.abandonedCheckoutCount,
  }
}

function buildShopifyMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  shopDomain: string,
  data: IntelligenceShopify
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  rows.push({
    client_id: clientId,
    user_email: userEmail,
    platform: 'shopify',
    entity_level: 'account',
    entity_id: shopDomain,
    entity_name: shopDomain,
    date: captureDate,
    breakdown_type: '',
    breakdown_value: '',
    revenue: data.totalRevenue ?? 0,
    conversions: data.totalOrders ?? 0,
    extra: shopifyAccountExtra(data),
  })

  for (const product of data.topProducts || []) {
    rows.push({
      client_id: clientId,
      user_email: userEmail,
      platform: 'shopify',
      entity_level: 'product',
      entity_id: product.id,
      entity_name: product.name,
      parent_entity_id: shopDomain,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      revenue: product.revenue,
      conversions: product.units,
      extra: { units: product.units },
    })
  }

  return rows
}

function serializeCaughtError(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader
  ).trim()

  if (!envSecret || gotToken !== envSecret) {
    console.error(
      `[cron] auth failed — envSecretSet: ${Boolean(process.env.CRON_SECRET)}, envLen: ${envSecret.length}, gotTokenLen: ${gotToken.length}`
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { startDate: captureDate } = resolveDateWindow('YESTERDAY')

  const summary = {
    date: captureDate,
    clientsProcessed: 0,
    shopifyConnections: 0,
    rowsWritten: 0,
    errors: [] as SyncError[],
  }

  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')

  if (clientsError) {
    console.error('[cron/sync] failed to load clients:', clientsError)
    return NextResponse.json(
      { error: 'Failed to load clients', detail: clientsError.message },
      { status: 500 }
    )
  }

  const clientRows = (clients || []) as ClientRow[]

  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const shopifyConnections = connections.filter(c => c.platform === 'shopify')

    if (shopifyConnections.length === 0) {
      continue
    }

    summary.clientsProcessed += 1

    for (const conn of shopifyConnections) {
      summary.shopifyConnections += 1
      const shopDomain = conn.account_id
      const userEmail = conn.user_email || client.user_email

      try {
        const tokenResult = await getValidShopifyToken(userEmail, shopDomain)
        if (!tokenResult.ok) {
          throw new Error(
            `Shopify token unavailable: ${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}`
          )
        }

        const intel = await fetchShopifyIntelligence(
          tokenResult.accessToken,
          shopDomain,
          'YESTERDAY',
          captureDate,
          captureDate
        )

        const rows = buildShopifyMetricsRows(
          client.id,
          userEmail,
          captureDate,
          shopDomain,
          intel
        )

        const { error: metricsError } = await supabaseAdmin
          .from('metrics_daily')
          .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })

        if (metricsError) {
          throw metricsError
        }

        summary.rowsWritten += rows.length

        const { error: syncError } = await supabaseAdmin
          .from('sync_state')
          .upsert(
            {
              client_id: client.id,
              platform: 'shopify',
              last_forward_sync_date: captureDate,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'client_id,platform' }
          )

        if (syncError) {
          throw syncError
        }
      } catch (err) {
        const message = serializeCaughtError(err)
        console.error(
          `[cron/sync] client=${client.id} platform=shopify shop=${shopDomain}:`,
          message
        )
        summary.errors.push({
          clientId: client.id,
          platform: 'shopify',
          message,
        })
      }
    }
  }

  return NextResponse.json(summary)
}
