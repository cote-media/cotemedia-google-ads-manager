// LORAMER_FORWARD_CAPTURE_CRON_V1
// Nightly forward-capture: yesterday's Shopify + Meta + Google metrics -> metrics_daily.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { fetchShopifyIntelligence } from '@/lib/intelligence/shopify-intelligence'
import { buildShopifyMetricsRows, buildShopifyDepthRows } from '@/lib/intelligence/shopify-metrics-row' // LORAMER_SHOPIFY_DEPTH_2A_V1
import { buildMetaMetricsRows } from '@/lib/intelligence/meta-metrics-row'
import { buildGoogleMetricsRows } from '@/lib/intelligence/google-metrics-row'
import { buildWooMetricsRows } from '@/lib/intelligence/woocommerce-metrics-row'
import { fetchMetaIntelligence } from '@/lib/intelligence/meta-intelligence'
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchGoogleDimensional, buildGoogleDimensionalRows } from '@/lib/intelligence/google-dimensional' // LORAMER_SEARCH_TERMS_CAPTURE_V1
import { fetchGoogleDeviceDay, buildGoogleDeviceRows } from '@/lib/intelligence/google-device' // LORAMER_GOOGLE_DEVICE_CAPTURE_V1
import { GEOGRAPHIC_GRAINS, USER_GRAINS, fetchGeoGrainDay, buildGeoGrainRows } from '@/lib/intelligence/google-geo' // LORAMER_GOOGLE_GEO_CAPTURE_V1
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'
import { fetchGaIntelligence } from '@/lib/intelligence/ga-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { getValidGaToken } from '@/lib/ga-token'
import { buildGaMetricsRows } from '@/lib/intelligence/ga-metrics-row'
import { recordConnectionResult, recordConnectionAuthFailure, classifyConnectionError } from '@/lib/connection-health' // LORAMER_CONNECTION_HEALTH_V1
import { normalizeMetricsRows } from '@/lib/metrics-normalize' // LORAMER_METRICS_NORMALIZE_V1
import { detectTrigger, cronRunPlatforms, startCronRuns, finishCronRun } from '@/lib/cron-runs' // LORAMER_CRON_RUNS_SENTINEL_V1
import type {
  IntelligenceGa,
} from '@/lib/intelligence/intelligence-types'

// LORAMER_WOO_BACKFILL_ATOMIC_BREAKER_V1 (Lesson 52 defense-in-depth) — opt out of Next.js App Router
// fetch caching so the supabase-js last_forward_sync_date read + metrics_daily/sync_state writes always
// hit the primary fresh. Preventative: a stale cursor read here is idempotent (re-syncs a day), not corrupting.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

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

// LORAMER_SHOPIFY_DEPTH_2A_V1 — buildShopifyMetricsRows (account MAIN row) +
// buildShopifyDepthRows (product net + geo breakdowns) moved to
// @/lib/intelligence/shopify-metrics-row (imported above).

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

// WS1a — cron maxDuration band-aid to stop loop-tail starvation. The 5 sequential
// per-client platform loops (Shopify→Meta→Google→Woo→GA) were exceeding the default
// serverless duration cap, silently dropping the tail (GA + Woo + Google-tail clients).
// 300s = the Pro serverless max — full headroom for all 5 platform loops. Real fix = WS1c.
export const maxDuration = 300

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
  // LORAMER_CRON_DISTINCT_COUNT_V1 — FIX 5: clientsProcessed is one Set of distinct client ids
  // across the five per-platform loops, not five separate +=1 (which counted a multi-platform
  // client once per platform). Cosmetic; no behavior change.
  const processedClientIds = new Set<string>()

  // LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1) — parse the platform gate + write started markers
  // BEFORE the clients query / heavy work, so a crash or maxDuration kill still leaves a started
  // row with finished_at NULL (the silent-hole signal). Observability only; never throws.
  const platform = (new URL(request.url).searchParams.get('platform') ?? 'all').trim().toLowerCase()
  const cronTrigger = detectTrigger(request)
  const cronRunIds = await startCronRuns({
    mode: 'forward',
    platforms: cronRunPlatforms(platform),
    trigger: cronTrigger,
    targetDate: captureDate,
  })

  // Per-section finalize: derive this platform's tallies from the summary delta since the section
  // began, then stamp finished_at. Sections run sequentially and each pushes only its own
  // platform's errors, so every error added during a section belongs to that section's platform.
  const ATTEMPT_KEYS: Record<string, keyof typeof summary> = {
    shopify: 'shopifyConnections',
    meta: 'metaConnections',
    google: 'googleConnections',
    woocommerce: 'wooConnections',
    ga: 'gaConnections',
  }
  async function finalizeSection(p: string, snap: { rows: number; errs: number }) {
    const errsForP = summary.errors.slice(snap.errs)
    const erroredConns = new Set(errsForP.map(e => e.clientId)).size
    const attempted = (summary[ATTEMPT_KEYS[p]] as number) ?? 0
    await finishCronRun(cronRunIds[p], {
      connectionsAttempted: attempted,
      connectionsErrored: erroredConns,
      connectionsSucceeded: Math.max(0, attempted - erroredConns),
      rowsWritten: summary.rowsWritten - snap.rows,
      errorCount: errsForP.length,
    })
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

  // LORAMER_CRON_PLATFORM_SPLIT_V1 (WS1c step 1) — `platform` (parsed above) gates each per-platform
  // loop. No param / platform==='all' runs all 5 (backward-compatible manual full-sync); the Vercel
  // crons fire one platform each on staggered minutes so every platform gets its own 300s budget.

  if (platform === 'all' || platform === 'shopify') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const shopifyConnections = connections.filter(c => c.platform === 'shopify')

    if (shopifyConnections.length === 0) {
      continue
    }

    processedClientIds.add(client.id)

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
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })

        if (metricsError) {
          throw metricsError
        }

        summary.rowsWritten += rows.length

        // LORAMER_SHOPIFY_DEPTH_2A_V1 — product-net + ship-to geo depth in its OWN try/catch:
        // a depth failure logs LOUD and is recorded, but NEVER drops the account main row or
        // sync_state. 0 rows = logged empty (not error); UNKNOWN-address share logged.
        try {
          const depthRows = buildShopifyDepthRows(client.id, userEmail, captureDate, shopDomain, intel)
          if (intel.unknownGeoOrders) {
            console.warn(
              `[cron/sync] client=${client.id} platform=shopify geo UNKNOWN-address orders=${intel.unknownGeoOrders}`
            )
          }
          if (depthRows.length === 0) {
            console.log(
              `[cron/sync] client=${client.id} platform=shopify depth: 0 product/geo rows (empty, not an error)`
            )
          } else {
            const { error: depthError } = await supabaseAdmin
              .from('metrics_daily')
              .upsert(normalizeMetricsRows(depthRows), { onConflict: METRICS_DAILY_CONFLICT })
            if (depthError) throw depthError
            summary.rowsWritten += depthRows.length
          }
        } catch (depthErr) {
          const message = serializeCaughtError(depthErr)
          console.error(
            `[cron/sync] client=${client.id} platform=shopify depth capture FAILED:`,
            message
          )
          summary.errors.push({ clientId: client.id, platform: 'shopify', message: `depth: ${message}` })
        }

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

        // LORAMER_CONNECTION_HEALTH_V1 — this shop authenticated; heal it.
        await recordConnectionResult({ platform: 'shopify', clientId: client.id, accountId: shopDomain, userEmail })
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
        // LORAMER_CONNECTION_HEALTH_V1 — AUTH-class only; transient/empty leaves health untouched.
        await recordConnectionResult({ platform: 'shopify', clientId: client.id, accountId: shopDomain, userEmail, error: err })
      }
    }
  }
  await finalizeSection('shopify', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end shopify guard

  if (platform === 'all' || platform === 'meta') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const metaConnections = connections.filter(c => c.platform === 'meta')

    if (metaConnections.length === 0) {
      continue
    }

    processedClientIds.add(client.id)

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
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })

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

        // LORAMER_CONNECTION_HEALTH_V1
        await recordConnectionResult({ platform: 'meta', clientId: client.id, accountId, userEmail })
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
        // LORAMER_CONNECTION_HEALTH_V1 — Meta code-190 flips the whole FB-token credential.
        await recordConnectionResult({ platform: 'meta', clientId: client.id, accountId, userEmail, error: err })
      }
    }
  }
  await finalizeSection('meta', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end meta guard

  if (platform === 'all' || platform === 'google') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const googleConnections = connections.filter(c => c.platform === 'google')

    if (googleConnections.length === 0) {
      continue
    }

    processedClientIds.add(client.id)

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
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })

        if (metricsError) {
          throw metricsError
        }

        summary.rowsWritten += rows.length

        // LORAMER_SEARCH_TERMS_CAPTURE_V1 — dimensional capture (search terms + keywords) as
        // breakdown rows. Own try/catch: a dimensional failure logs LOUD and is recorded, but never
        // drops the platform's main rows or its sync_state write. 0 rows = logged empty, not error.
        try {
          const dim = await fetchGoogleDimensional(tokenRow.refresh_token, customerId, captureDate, captureDate)
          if (dim.searchTermsTruncated || dim.keywordsTruncated) {
            console.warn(
              `[cron/sync] client=${client.id} platform=google dimensional capture TRUNCATED — searchTerms@cap=${dim.searchTermsTruncated} keywords@cap=${dim.keywordsTruncated} (lower-spend rows dropped)`
            )
          }
          const dimRows = buildGoogleDimensionalRows(client.id, userEmail, captureDate, customerId, dim)
          if (dimRows.length === 0) {
            console.log(
              `[cron/sync] client=${client.id} platform=google dimensional capture: 0 search-term/keyword rows (empty, not an error)`
            )
          } else {
            const { error: dimError } = await supabaseAdmin
              .from('metrics_daily')
              .upsert(normalizeMetricsRows(dimRows), { onConflict: METRICS_DAILY_CONFLICT })
            if (dimError) throw dimError
            summary.rowsWritten += dimRows.length
          }
        } catch (dimErr) {
          const message = serializeCaughtError(dimErr)
          console.error(
            `[cron/sync] client=${client.id} platform=google dimensional capture FAILED:`,
            message
          )
          summary.errors.push({ clientId: client.id, platform: 'google', message: `dimensional: ${message}` })
        }

        // LORAMER_GOOGLE_DEVICE_CAPTURE_V1 — device breakdown capture (campaign × device) as breakdown
        // rows. Own try/catch (mirrors the dimensional block above): a device failure logs LOUD and is
        // recorded, but NEVER drops the platform's main rows, the dimensional rows, or its sync_state write.
        // 0 rows = logged empty, not error. No forward reconcile (the backfill/drain + catchup carry it).
        try {
          const devRows = buildGoogleDeviceRows(
            client.id,
            userEmail,
            captureDate,
            customerId,
            await fetchGoogleDeviceDay(tokenRow.refresh_token, customerId, captureDate)
          )
          if (devRows.length === 0) {
            console.log(
              `[cron/sync] client=${client.id} platform=google device capture: 0 device rows (empty, not an error)`
            )
          } else {
            const { error: devError } = await supabaseAdmin
              .from('metrics_daily')
              .upsert(normalizeMetricsRows(devRows), { onConflict: METRICS_DAILY_CONFLICT })
            if (devError) throw devError
            summary.rowsWritten += devRows.length
          }
        } catch (devErr) {
          const message = serializeCaughtError(devErr)
          console.error(
            `[cron/sync] client=${client.id} platform=google device capture FAILED:`,
            message
          )
          summary.errors.push({ clientId: client.id, platform: 'google', message: `device: ${message}` })
        }

        // LORAMER_GOOGLE_GEO_CAPTURE_V1 — geo breakdown FAMILY (per-grain, both resources: 10 geographic_view +
        // 9 user_location_view = 19 queries/client/day). Own try/catch PER FAMILY (mirrors the device block): a
        // geo failure logs LOUD and is recorded, but NEVER drops base/dimensional/device rows or sync_state.
        // WRITE-ONLY — no reconcile (geo is non-partitioning: location_type overlap + multi-grain).
        for (const [famLabel, grains] of [['geo', GEOGRAPHIC_GRAINS], ['user_geo', USER_GRAINS]] as const) {
          try {
            let famRows = 0
            for (const grain of grains) {
              const built = buildGeoGrainRows(grain, client.id, userEmail, captureDate, customerId, await fetchGeoGrainDay(grain, tokenRow.refresh_token, customerId, captureDate))
              if (built.length > 0) {
                const { error: geoError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                if (geoError) throw geoError
                summary.rowsWritten += built.length; famRows += built.length
              }
            }
            if (famRows === 0) {
              console.log(`[cron/sync] client=${client.id} platform=google ${famLabel} capture: 0 rows (empty, not an error)`)
            }
          } catch (geoErr) {
            const message = serializeCaughtError(geoErr)
            console.error(`[cron/sync] client=${client.id} platform=google ${famLabel} capture FAILED:`, message)
            summary.errors.push({ clientId: client.id, platform: 'google', message: `${famLabel}: ${message}` })
          }
        }

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

        // LORAMER_CONNECTION_HEALTH_V1
        await recordConnectionResult({ platform: 'google', clientId: client.id, accountId: customerId, userEmail })
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
        // LORAMER_CONNECTION_HEALTH_V1 — invalid_grant flips the whole MCC OAuth credential;
        // a per-customer permission denial flips only this account.
        await recordConnectionResult({ platform: 'google', clientId: client.id, accountId: customerId, userEmail, error: err })
      }
    }
  }
  await finalizeSection('google', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end google guard

  if (platform === 'all' || platform === 'woocommerce') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  for (const client of clientRows) {
    const connections = client.platform_connections || []
    const wooConnections = connections.filter(c => c.platform === 'woocommerce')

    if (wooConnections.length === 0) {
      continue
    }

    processedClientIds.add(client.id)

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
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })

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

        // LORAMER_CONNECTION_HEALTH_V1
        await recordConnectionResult({ platform: 'woocommerce', clientId: client.id, accountId: tok.store_url, userEmail })
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
        // LORAMER_CONNECTION_HEALTH_V1 — 401/auth flips; WAF 406 / timeout does not.
        await recordConnectionResult({ platform: 'woocommerce', clientId: client.id, accountId: conn.account_id, userEmail, error: err })
      }
    }
  }
  await finalizeSection('woocommerce', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end woocommerce guard

  if (platform === 'all' || platform === 'ga') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  for (const client of clientRows) {
    const userEmail = client.user_email
    let gaPropertyIdForHealth = '' // LORAMER_CONNECTION_HEALTH_V1 — hoisted so the catch can address the row

    try {
      const gaToken = await getValidGaToken(client.id, userEmail)

      if (!gaToken.ok) {
        if (gaToken.reason !== 'no_token') {
          const message = `GA token unavailable: ${gaToken.reason}${gaToken.detail ? ' - ' + gaToken.detail : ''}`
          summary.errors.push({ clientId: client.id, platform: 'ga', message })
          // LORAMER_CONNECTION_HEALTH_V1 — a GA row EXISTS but its token won't refresh
          // (this is exactly the invalid_grant case). Flip the per-client GA credential.
          // reason==='no_token' is skipped: that just means "GA not connected" for this client.
          const { authClass, code } = classifyConnectionError('ga', message)
          if (authClass) {
            await recordConnectionAuthFailure({ platform: 'ga', authClass, code, clientId: client.id, userEmail })
          }
        }
        continue
      }

      processedClientIds.add(client.id)
      summary.gaConnections += 1
      gaPropertyIdForHealth = gaToken.gaPropertyId

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
        .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })

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

      // LORAMER_CONNECTION_HEALTH_V1 — GA property authenticated; heal it.
      await recordConnectionResult({ platform: 'ga', clientId: client.id, accountId: gaPropertyIdForHealth, userEmail })
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
      // LORAMER_CONNECTION_HEALTH_V1 — auth-class fetch failure flips the GA credential
      // (only reached when the token was valid, so gaPropertyIdForHealth is set).
      await recordConnectionResult({ platform: 'ga', clientId: client.id, accountId: gaPropertyIdForHealth, userEmail, error: err })
    }
  }
  await finalizeSection('ga', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end ga guard

  summary.clientsProcessed = processedClientIds.size // FIX 5: distinct clients, not per-platform sum
  return NextResponse.json(summary)
}
