// LORAMER_FORWARD_CAPTURE_CRON_V1
// Nightly forward-capture: yesterday's Shopify + Meta + Google metrics -> metrics_daily.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { fetchMetaIntelligence } from '@/lib/intelligence/meta-intelligence'
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'
import { fetchGaIntelligence } from '@/lib/intelligence/ga-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { getValidGaToken } from '@/lib/ga-token'
import type {
  IntelligenceGa,
  IntelligenceMetrics,
  IntelligenceShopify,
  PlatformIntelligence,
} from '@/lib/intelligence/intelligence-types'

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

function metaMetricsExtra(metrics: IntelligenceMetrics): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    cpm: metrics.cpm,
    roas: metrics.roas,
    cpa: metrics.cpa,
    convRate: metrics.convRate,
  }
  if (metrics.reach != null) extra.reach = metrics.reach
  if (metrics.frequency != null) extra.frequency = metrics.frequency
  if (metrics.purchases != null) extra.purchases = metrics.purchases
  if (metrics.addToCart != null) extra.addToCart = metrics.addToCart
  if (metrics.initiateCheckout != null) {
    extra.initiateCheckout = metrics.initiateCheckout
  }
  if (metrics.viewContent != null) extra.viewContent = metrics.viewContent
  if (metrics.costPerPurchase != null) {
    extra.costPerPurchase = metrics.costPerPurchase
  }
  if (metrics.costPerAddToCart != null) {
    extra.costPerAddToCart = metrics.costPerAddToCart
  }
  return extra
}

function buildMetaMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  accountId: string,
  accountName: string | null | undefined,
  data: PlatformIntelligence
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const totals = data.totals

  const pushRow = (
    entityLevel: string,
    entityId: string,
    entityName: string,
    metrics: IntelligenceMetrics,
    parentEntityId?: string
  ) => {
    const row: Record<string, unknown> = {
      client_id: clientId,
      user_email: userEmail,
      platform: 'meta',
      entity_level: entityLevel,
      entity_id: entityId,
      entity_name: entityName,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      conversion_value: metrics.conversionValue,
      revenue: 0,
      extra: metaMetricsExtra(metrics),
    }
    if (parentEntityId) {
      row.parent_entity_id = parentEntityId
    }
    rows.push(row)
  }

  pushRow(
    'account',
    accountId,
    accountName || accountId,
    totals
  )

  for (const campaign of data.campaigns || []) {
    pushRow(
      'campaign',
      campaign.id,
      campaign.name,
      campaign.metrics,
      accountId
    )
  }

  for (const adSet of data.adGroups || []) {
    pushRow(
      'ad_set',
      adSet.id,
      adSet.name,
      adSet.metrics,
      adSet.campaignId
    )
  }

  for (const ad of data.ads || []) {
    pushRow(
      'ad',
      ad.id,
      ad.name,
      ad.metrics,
      ad.adGroupId
    )
  }

  return rows
}

function googleMetricsExtra(metrics: IntelligenceMetrics): Record<string, unknown> {
  return {
    ctr: metrics.ctr,
    cpc: metrics.cpc,
    cpm: metrics.cpm,
    roas: metrics.roas,
    cpa: metrics.cpa,
    convRate: metrics.convRate,
  }
}

function buildGoogleMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  customerId: string,
  accountName: string | null | undefined,
  data: PlatformIntelligence
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  const pushRow = (
    entityLevel: string,
    entityId: string,
    entityName: string,
    metrics: IntelligenceMetrics,
    parentEntityId?: string
  ) => {
    const row: Record<string, unknown> = {
      client_id: clientId,
      user_email: userEmail,
      platform: 'google',
      entity_level: entityLevel,
      entity_id: entityId,
      entity_name: entityName,
      date: captureDate,
      breakdown_type: '',
      breakdown_value: '',
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      conversion_value: metrics.conversionValue,
      revenue: 0,
      extra: googleMetricsExtra(metrics),
    }
    if (parentEntityId) {
      row.parent_entity_id = parentEntityId
    }
    rows.push(row)
  }

  pushRow('account', customerId, accountName || customerId, data.totals)

  for (const campaign of data.campaigns || []) {
    pushRow('campaign', campaign.id, campaign.name, campaign.metrics, customerId)
  }

  for (const adGroup of data.adGroups || []) {
    pushRow('ad_group', adGroup.id, adGroup.name, adGroup.metrics, adGroup.campaignId)
  }

  for (const ad of data.ads || []) {
    pushRow('ad', ad.id, ad.name, ad.metrics, ad.adGroupId)
  }

  return rows
}

function buildWooMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  storeUrl: string,
  data: IntelligenceShopify
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  rows.push({
    client_id: clientId,
    user_email: userEmail,
    platform: 'woocommerce',
    entity_level: 'account',
    entity_id: storeUrl,
    entity_name: storeUrl,
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
      platform: 'woocommerce',
      entity_level: 'product',
      entity_id: product.id,
      entity_name: product.name,
      parent_entity_id: storeUrl,
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

function gaExtra(data: IntelligenceGa): Record<string, unknown> {
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

function buildGaMetricsRows(
  clientId: string,
  userEmail: string,
  captureDate: string,
  propertyId: string,
  propertyName: string,
  data: IntelligenceGa
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
    metaConnections: 0,
    googleConnections: 0,
    wooConnections: 0,
    gaConnections: 0,
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

  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const metaConnections = connections.filter(c => c.platform === 'meta')

    if (metaConnections.length === 0) {
      continue
    }

    summary.clientsProcessed += 1

    for (const conn of metaConnections) {
      summary.metaConnections += 1
      const accountId = conn.account_id
      const userEmail = conn.user_email || client.user_email

      try {
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from('meta_tokens')
          .select('access_token')
          .eq('user_email', userEmail)
          .single()

        if (tokenError || !tokenRow?.access_token) {
          throw new Error(
            tokenError?.message || 'No Meta token found'
          )
        }

        const intel = await fetchMetaIntelligence(
          tokenRow.access_token,
          accountId,
          'YESTERDAY',
          captureDate,
          captureDate
        )

        const rows = buildMetaMetricsRows(
          client.id,
          userEmail,
          captureDate,
          accountId,
          conn.account_name,
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
              platform: 'meta',
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
          `[cron/sync] client=${client.id} platform=meta account=${accountId}:`,
          message
        )
        summary.errors.push({
          clientId: client.id,
          platform: 'meta',
          message,
        })
      }
    }
  }

  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const googleConnections = connections.filter(c => c.platform === 'google')

    if (googleConnections.length === 0) {
      continue
    }

    summary.clientsProcessed += 1

    for (const conn of googleConnections) {
      summary.googleConnections += 1
      const customerId = conn.account_id
      const userEmail = conn.user_email || client.user_email

      try {
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from('google_tokens')
          .select('refresh_token')
          .eq('user_email', userEmail)
          .single()

        if (tokenError || !tokenRow?.refresh_token) {
          throw new Error(tokenError?.message || 'No Google refresh token found')
        }

        const intel = await fetchGoogleIntelligence(
          tokenRow.refresh_token,
          customerId,
          'YESTERDAY',
          process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
          process.env.GOOGLE_CLIENT_ID!,
          process.env.GOOGLE_CLIENT_SECRET!,
          process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          captureDate,
          captureDate
        )

        const rows = buildGoogleMetricsRows(
          client.id,
          userEmail,
          captureDate,
          customerId,
          conn.account_name,
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
              platform: 'google',
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
          `[cron/sync] client=${client.id} platform=google customer=${customerId}:`,
          message
        )
        summary.errors.push({
          clientId: client.id,
          platform: 'google',
          message,
        })
      }
    }
  }

  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const wooConnections = connections.filter(c => c.platform === 'woocommerce')

    if (wooConnections.length === 0) {
      continue
    }

    summary.clientsProcessed += 1

    for (const conn of wooConnections) {
      summary.wooConnections += 1
      const userEmail = conn.user_email || client.user_email

      try {
        const { data: tok, error: tokError } = await supabaseAdmin
          .from('woocommerce_tokens')
          .select('store_url, consumer_key, consumer_secret')
          .eq('user_email', userEmail)
          .eq('client_id', client.id)
          .single()

        if (tokError || !tok?.consumer_key || !tok?.consumer_secret || !tok?.store_url) {
          throw new Error(tokError?.message || 'No WooCommerce credentials found')
        }

        const intel = await fetchWooCommerceIntelligence(
          tok.store_url,
          tok.consumer_key,
          tok.consumer_secret,
          'YESTERDAY',
          captureDate,
          captureDate
        )

        const rows = buildWooMetricsRows(
          client.id,
          userEmail,
          captureDate,
          tok.store_url,
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
              platform: 'woocommerce',
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
          `[cron/sync] client=${client.id} platform=woocommerce:`,
          message
        )
        summary.errors.push({
          clientId: client.id,
          platform: 'woocommerce',
          message,
        })
      }
    }
  }

  for (const client of clientRows) {
    const userEmail = client.user_email

    try {
      const gaToken = await getValidGaToken(client.id, userEmail)

      if (!gaToken.ok) {
        if (gaToken.reason !== 'no_token') {
          summary.errors.push({
            clientId: client.id,
            platform: 'ga',
            message: `GA token unavailable: ${gaToken.reason}${gaToken.detail ? ' - ' + gaToken.detail : ''}`,
          })
        }
        continue
      }

      summary.clientsProcessed += 1
      summary.gaConnections += 1

      const intel = await fetchGaIntelligence(
        gaToken.gaPropertyId,
        gaToken.accessToken,
        'YESTERDAY',
        gaToken.gaPropertyName,
        captureDate,
        captureDate
      )

      const rows = buildGaMetricsRows(
        client.id,
        userEmail,
        captureDate,
        gaToken.gaPropertyId,
        gaToken.gaPropertyName,
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
            platform: 'ga',
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
        `[cron/sync] client=${client.id} platform=ga:`,
        message
      )
      summary.errors.push({
        clientId: client.id,
        platform: 'ga',
        message,
      })
    }
  }

  return NextResponse.json(summary)
}
