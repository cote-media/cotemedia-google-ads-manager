// LORAMER_CATCHUP_LOOP_2B_V1
// Presence-based catch-up: repairs INTERIOR holes in metrics_daily (days a platform
// was skipped by the forward cron) WITHOUT trusting last_forward_sync_date. Per
// (client, platform, account): read which dates already have an entity_level='account',
// breakdown_type='' main row in the last CATCHUP_WINDOW_DAYS; if a recent baseline
// exists, fill the OLDEST up-to-CATCHUP_DAY_CAP missing days oldest-first by replaying
// the SAME fetch + shared builders the forward cron runs, with (CUSTOM, day, day).
//
// Catchup writes ONLY metrics_daily. It NEVER touches sync_state and NEVER calls the
// connection-health engine — those remain the forward cron's job (cron/sync/route.ts).
// Idempotent on METRICS_DAILY_CONFLICT, so overlap with the forward run is a harmless
// rewrite. Per-day errors are recorded and skipped (presence detection self-retries).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow, addDaysIso } from '@/lib/date-range'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { buildShopifyMetricsRows, buildShopifyDepthRows } from '@/lib/intelligence/shopify-metrics-row'
import { buildMetaMetricsRows } from '@/lib/intelligence/meta-metrics-row'
import { buildGoogleMetricsRows } from '@/lib/intelligence/google-metrics-row'
import { buildWooMetricsRows } from '@/lib/intelligence/woocommerce-metrics-row'
import { buildGaMetricsRows } from '@/lib/intelligence/ga-metrics-row'
import { fetchMetaIntelligence } from '@/lib/intelligence/meta-intelligence'
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchGoogleDimensional, buildGoogleDimensionalRows } from '@/lib/intelligence/google-dimensional'
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'
import { fetchGaIntelligence } from '@/lib/intelligence/ga-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { getValidGaToken } from '@/lib/ga-token'

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const CATCHUP_WINDOW_DAYS = 35
const CATCHUP_DAY_CAP = 14

// 300s = the Pro serverless max — catchup runs in its OWN fresh budget, separate from
// the forward cron, so a multi-day repair never competes with the nightly yesterday run.
export const maxDuration = 300

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

// Presence-based gap detection for ONE (client, platform, account). Returns the
// oldest-first list of missing day strings to fill this run (≤ CATCHUP_DAY_CAP),
// or [] when there is no recent baseline (skip) or no interior holes.
async function computeFillDays(
  clientId: string,
  platform: string,
  accountId: string,
  windowStart: string,
  yesterday: string
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('metrics_daily')
    .select('date')
    .eq('client_id', clientId)
    .eq('platform', platform)
    .eq('account_id', accountId)
    .eq('entity_level', 'account')
    .eq('breakdown_type', '')
    .gte('date', windowStart)
    .lte('date', yesterday)
  if (error) {
    throw new Error(`presence query failed: ${error.message}`)
  }

  const present = new Set<string>()
  for (const row of data || []) {
    // normalize whatever the column returns to 'YYYY-MM-DD'
    present.add(String((row as { date: string }).date).slice(0, 10))
  }

  // No recent baseline in the window -> NOT catchup's job (forward cron / deep backfill).
  if (present.size === 0) {
    return []
  }

  // floor = earliest present date in the window; only repair holes ABOVE the floor.
  let floor = yesterday
  for (const d of present) {
    if (d < floor) floor = d
  }

  const missing: string[] = []
  for (let d = floor; d <= yesterday; d = addDaysIso(d, 1)) {
    if (!present.has(d)) missing.push(d)
  }
  return missing.slice(0, CATCHUP_DAY_CAP)
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
      `[cron/catchup] auth failed — envSecretSet: ${Boolean(process.env.CRON_SECRET)}, envLen: ${envSecret.length}, gotTokenLen: ${gotToken.length}`
    )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const yesterday = resolveDateWindow('YESTERDAY').startDate
  const windowStart = addDaysIso(yesterday, -(CATCHUP_WINDOW_DAYS - 1))

  const summary = {
    mode: 'catchup',
    window: { start: windowStart, end: yesterday },
    dayCap: CATCHUP_DAY_CAP,
    clientsProcessed: 0,
    shopifyConnections: 0,
    metaConnections: 0,
    googleConnections: 0,
    wooConnections: 0,
    gaConnections: 0,
    accountsWithGaps: 0,
    daysFilled: 0,
    rowsWritten: 0,
    errors: [] as SyncError[],
  }
  const processedClientIds = new Set<string>()

  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('clients')
    .select('id, user_email, platform_connections(*)')

  if (clientsError) {
    console.error('[cron/catchup] failed to load clients:', clientsError)
    return NextResponse.json(
      { error: 'Failed to load clients', detail: clientsError.message },
      { status: 500 }
    )
  }

  const clientRows = (clients || []) as ClientRow[]

  // Same ?platform= gate as the forward cron: no param / 'all' = all 5; else just that one.
  const platform = (new URL(request.url).searchParams.get('platform') ?? 'all').trim().toLowerCase()

  // ── SHOPIFY ──────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'shopify') {
  for (const client of clientRows) {
    const shopifyConnections = (client.platform_connections || []).filter(c => c.platform === 'shopify')
    if (shopifyConnections.length === 0) continue

    for (const conn of shopifyConnections) {
      summary.shopifyConnections += 1
      const shopDomain = conn.account_id
      const userEmail = conn.user_email || client.user_email

      let fillDays: string[] = []
      try {
        fillDays = await computeFillDays(client.id, 'shopify', shopDomain, windowStart, yesterday)
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'shopify', message: serializeCaughtError(err) })
        continue
      }
      if (fillDays.length === 0) continue
      summary.accountsWithGaps += 1
      processedClientIds.add(client.id)

      let accessToken: string
      try {
        const tokenResult = await getValidShopifyToken(userEmail, shopDomain)
        if (!tokenResult.ok) {
          throw new Error(
            `Shopify token unavailable: ${tokenResult.reason}${tokenResult.detail ? ' - ' + tokenResult.detail : ''}`
          )
        }
        accessToken = tokenResult.accessToken
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'shopify', message: serializeCaughtError(err) })
        continue
      }

      for (const d of fillDays) {
        try {
          const intel = await fetchShopifyIntelligence(accessToken, shopDomain, 'CUSTOM', d, d)
          const rows = buildShopifyMetricsRows(client.id, userEmail, d, shopDomain, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
          if (metricsError) throw metricsError
          summary.rowsWritten += rows.length
          summary.daysFilled += 1

          // Shopify depth (product net + ship-to geo) — own try/catch so a depth
          // failure never drops the main row (mirrors the forward cron).
          try {
            const depthRows = buildShopifyDepthRows(client.id, userEmail, d, shopDomain, intel)
            if (depthRows.length > 0) {
              const { error: depthError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(depthRows, { onConflict: METRICS_DAILY_CONFLICT })
              if (depthError) throw depthError
              summary.rowsWritten += depthRows.length
            }
          } catch (depthErr) {
            summary.errors.push({ clientId: client.id, platform: 'shopify', message: `depth ${d}: ${serializeCaughtError(depthErr)}` })
          }
        } catch (err) {
          summary.errors.push({ clientId: client.id, platform: 'shopify', message: `${d}: ${serializeCaughtError(err)}` })
          continue
        }
      }
    }
  }
  }

  // ── META ─────────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'meta') {
  for (const client of clientRows) {
    const metaConnections = (client.platform_connections || []).filter(c => c.platform === 'meta')
    if (metaConnections.length === 0) continue

    for (const conn of metaConnections) {
      summary.metaConnections += 1
      const accountId = conn.account_id
      const userEmail = conn.user_email || client.user_email

      let fillDays: string[] = []
      try {
        fillDays = await computeFillDays(client.id, 'meta', accountId, windowStart, yesterday)
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'meta', message: serializeCaughtError(err) })
        continue
      }
      if (fillDays.length === 0) continue
      summary.accountsWithGaps += 1
      processedClientIds.add(client.id)

      let accessToken: string
      try {
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from('meta_tokens')
          .select('access_token')
          .eq('user_email', userEmail)
          .single()
        if (tokenError || !tokenRow?.access_token) {
          throw new Error(tokenError?.message || 'No Meta token found')
        }
        accessToken = tokenRow.access_token
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'meta', message: serializeCaughtError(err) })
        continue
      }

      for (const d of fillDays) {
        try {
          const intel = await fetchMetaIntelligence(accessToken, accountId, 'CUSTOM', d, d)
          const rows = buildMetaMetricsRows(client.id, userEmail, d, accountId, conn.account_name, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
          if (metricsError) throw metricsError
          summary.rowsWritten += rows.length
          summary.daysFilled += 1
        } catch (err) {
          summary.errors.push({ clientId: client.id, platform: 'meta', message: `${d}: ${serializeCaughtError(err)}` })
          continue
        }
      }
    }
  }
  }

  // ── GOOGLE ───────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'google') {
  for (const client of clientRows) {
    const googleConnections = (client.platform_connections || []).filter(c => c.platform === 'google')
    if (googleConnections.length === 0) continue

    for (const conn of googleConnections) {
      summary.googleConnections += 1
      const customerId = conn.account_id
      const userEmail = conn.user_email || client.user_email

      let fillDays: string[] = []
      try {
        fillDays = await computeFillDays(client.id, 'google', customerId, windowStart, yesterday)
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'google', message: serializeCaughtError(err) })
        continue
      }
      if (fillDays.length === 0) continue
      summary.accountsWithGaps += 1
      processedClientIds.add(client.id)

      let refreshToken: string
      try {
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from('google_tokens')
          .select('refresh_token')
          .eq('user_email', userEmail)
          .single()
        if (tokenError || !tokenRow?.refresh_token) {
          throw new Error(tokenError?.message || 'No Google refresh token found')
        }
        refreshToken = tokenRow.refresh_token
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'google', message: serializeCaughtError(err) })
        continue
      }

      for (const d of fillDays) {
        try {
          const intel = await fetchGoogleIntelligence(
            refreshToken,
            customerId,
            'CUSTOM',
            process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID!,
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!,
            process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
            d,
            d
          )
          const rows = buildGoogleMetricsRows(client.id, userEmail, d, customerId, conn.account_name, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
          if (metricsError) throw metricsError
          summary.rowsWritten += rows.length
          summary.daysFilled += 1

          // Google dimensional (search terms + keywords) — own try/catch, permanent-loss
          // data, mirrors the forward cron's sub-capture.
          try {
            const dim = await fetchGoogleDimensional(refreshToken, customerId, d, d)
            const dimRows = buildGoogleDimensionalRows(client.id, userEmail, d, customerId, dim)
            if (dimRows.length > 0) {
              const { error: dimError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(dimRows, { onConflict: METRICS_DAILY_CONFLICT })
              if (dimError) throw dimError
              summary.rowsWritten += dimRows.length
            }
          } catch (dimErr) {
            summary.errors.push({ clientId: client.id, platform: 'google', message: `dimensional ${d}: ${serializeCaughtError(dimErr)}` })
          }
        } catch (err) {
          summary.errors.push({ clientId: client.id, platform: 'google', message: `${d}: ${serializeCaughtError(err)}` })
          continue
        }
      }
    }
  }
  }

  // ── WOOCOMMERCE ──────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'woocommerce') {
  for (const client of clientRows) {
    const wooConnections = (client.platform_connections || []).filter(c => c.platform === 'woocommerce')
    if (wooConnections.length === 0) continue

    for (const conn of wooConnections) {
      summary.wooConnections += 1
      const userEmail = conn.user_email || client.user_email

      // Woo's written account_id is the token's store_url (not conn.account_id), so read
      // the (cheap) creds first to learn store_url, then run presence against it.
      let storeUrl: string
      let consumerKey: string
      let consumerSecret: string
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
        storeUrl = tok.store_url
        consumerKey = tok.consumer_key
        consumerSecret = tok.consumer_secret
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'woocommerce', message: serializeCaughtError(err) })
        continue
      }

      let fillDays: string[] = []
      try {
        fillDays = await computeFillDays(client.id, 'woocommerce', storeUrl, windowStart, yesterday)
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'woocommerce', message: serializeCaughtError(err) })
        continue
      }
      if (fillDays.length === 0) continue
      summary.accountsWithGaps += 1
      processedClientIds.add(client.id)

      for (const d of fillDays) {
        try {
          const intel = await fetchWooCommerceIntelligence(storeUrl, consumerKey, consumerSecret, 'CUSTOM', d, d)
          const rows = buildWooMetricsRows(client.id, userEmail, d, storeUrl, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
          if (metricsError) throw metricsError
          summary.rowsWritten += rows.length
          summary.daysFilled += 1
        } catch (err) {
          summary.errors.push({ clientId: client.id, platform: 'woocommerce', message: `${d}: ${serializeCaughtError(err)}` })
          continue
        }
      }
    }
  }
  }

  // ── GA ───────────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'ga') {
  for (const client of clientRows) {
    // GA's account_id (property id) lives in ga_tokens. Read it cheaply FIRST so the
    // presence query can run BEFORE the expensive getValidGaToken refresh.
    let gaUserEmail: string
    let propertyId: string
    try {
      const { data: gaRow, error: gaRowError } = await supabaseAdmin
        .from('ga_tokens')
        .select('user_email, ga_property_id')
        .eq('client_id', client.id)
        .maybeSingle()
      if (gaRowError) {
        throw new Error(`ga_tokens lookup failed: ${gaRowError.message}`)
      }
      if (!gaRow?.user_email || !gaRow?.ga_property_id) {
        continue // no GA connection for this client
      }
      gaUserEmail = gaRow.user_email
      propertyId = gaRow.ga_property_id
    } catch (err) {
      summary.errors.push({ clientId: client.id, platform: 'ga', message: serializeCaughtError(err) })
      continue
    }
    summary.gaConnections += 1

    let fillDays: string[] = []
    try {
      fillDays = await computeFillDays(client.id, 'ga', propertyId, windowStart, yesterday)
    } catch (err) {
      summary.errors.push({ clientId: client.id, platform: 'ga', message: serializeCaughtError(err) })
      continue
    }
    if (fillDays.length === 0) continue
    summary.accountsWithGaps += 1
    processedClientIds.add(client.id)

    const gaToken = await getValidGaToken(client.id, gaUserEmail)
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

    for (const d of fillDays) {
      try {
        const intel = await fetchGaIntelligence(
          gaToken.gaPropertyId,
          gaToken.accessToken,
          'CUSTOM',
          gaToken.gaPropertyName,
          d,
          d
        )
        const rows = buildGaMetricsRows(client.id, gaUserEmail, d, gaToken.gaPropertyId, gaToken.gaPropertyName, intel)
        const { error: metricsError } = await supabaseAdmin
          .from('metrics_daily')
          .upsert(rows, { onConflict: METRICS_DAILY_CONFLICT })
        if (metricsError) throw metricsError
        summary.rowsWritten += rows.length
        summary.daysFilled += 1
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'ga', message: `${d}: ${serializeCaughtError(err)}` })
        continue
      }
    }
  }
  }

  summary.clientsProcessed = processedClientIds.size
  return NextResponse.json(summary)
}
