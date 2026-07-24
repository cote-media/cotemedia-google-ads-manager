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
import { META_BREADTH_FORWARD } from '@/lib/backfill/meta-breadth-forward' // LORAMER_META_BREADTH_FORWARD_V1 — forward capture for the 10 Meta breadth dims (G1)
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchGoogleDimensional, buildGoogleDimensionalRows } from '@/lib/intelligence/google-dimensional' // LORAMER_SEARCH_TERMS_CAPTURE_V1
import { DEVICE_GRAINS, fetchDeviceGrainDay, buildDeviceGrainRows } from '@/lib/intelligence/google-device' // LORAMER_GOOGLE_DEVICE_CAPTURE_V1
import { GEOGRAPHIC_GRAINS, USER_GRAINS, GEO_ENTITIES, fetchGeoGrainDay, buildGeoGrainRows } from '@/lib/intelligence/google-geo' // LORAMER_GOOGLE_GEO_CAPTURE_V1
import { HOUR_GRAINS, fetchHourGrainDay, buildHourGrainRows } from '@/lib/intelligence/google-hour' // LORAMER_GOOGLE_HOUR_CAPTURE_V1
import { DEMO_DIMENSIONS, DEMO_GRAINS, fetchDemographicDay, buildDemographicGrainRows } from '@/lib/intelligence/google-demographic' // LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3)
import { buildGoogleConversionActionRows } from '@/lib/intelligence/google-conversion-action' // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1
import { buildGoogleImpressionShareRows } from '@/lib/intelligence/google-impression-share' // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'
import { fetchGaIntelligence } from '@/lib/intelligence/ga-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { getValidGaToken } from '@/lib/ga-token'
import { buildGaMetricsRows } from '@/lib/intelligence/ga-metrics-row'
import { fetchGaDimensionalRows } from '@/lib/backfill/ga-dimensional-backfill' // LORAMER_GA_DIMENSIONAL_CAPTURE_V1 — forward dimensional breadth
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

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire wall-clock budget for the paged forward loops (mirrors the drain
// BUDGET_MS pattern; ~120s headroom under the 800s maxDuration so a client that starts just under budget finishes
// before the platform ceiling → no 504).
const FORWARD_BUDGET_MS = 680_000

// LORAMER_GA_FORWARD_DIM_LOOKBACK_V1 — GA4 dimensional data is NOT final at T+1. Google's processing takes 24-48h and
// the values CHANGE during it: intraday data has GAPS in event-scoped traffic-source dims (source/medium/campaign/
// channel group) and applies STRICTER cardinality limits (more "(other)" rows). A single-shot T+1 fetch therefore
// stores intraday-quality rows PERMANENTLY (the prior bug: cron/sync re-fetched captureDate ONLY and never re-touched
// a day — the "self-heals on the backfill re-walk" claim was FALSE because the ga_dimensional backfill sets
// backfill_complete=true and returns early). The fix: forward-dim re-fetches a TRAILING WINDOW ending at captureDate
// and upserts on the conflict key, so late-finalized values OVERWRITE the intraday ones. 7 days matches Fivetran's
// GA4 default late-arrival window; Airbyte ships a configurable GA4 lookback for the same reason. DO NOT reduce to 1
// — that reintroduces the intraday-permanence bug.
const GA_FORWARD_DIM_LOOKBACK_DAYS = 7
const addDaysUTC = (iso: string, n: number): string => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — forward paging: the clients CONNECTED to `platform` whose forward cursor
// (sync_state.last_forward_sync_date) is not yet captureDate, LEAST-RECENTLY-SYNCED first (NULLS-FIRST via '' key),
// stable id tie-break. Connection source = platform_connections for ALL 5 (GA is present there too, verified). This
// inverts the old physical-order full scan that always died before the tail.
async function pendingForwardClients(
  platform: string,
  clientRows: ClientRow[],
  captureDate: string
): Promise<ClientRow[]> {
  const connected = clientRows.filter(
    (c) => (c.platform_connections || []).some((pc) => pc.platform === platform)
  )
  if (connected.length === 0) return []
  const { data: ssRows } = await supabaseAdmin
    .from('sync_state')
    .select('client_id, last_forward_sync_date')
    .eq('platform', platform)
    .in('client_id', connected.map((c) => c.id))
  const lastByClient = new Map<string, string | null>()
  for (const r of ssRows || []) {
    lastByClient.set(
      (r as { client_id: string }).client_id,
      (r as { last_forward_sync_date: string | null }).last_forward_sync_date
    )
  }
  const pending = connected.filter((c) => lastByClient.get(c.id) !== captureDate)
  pending.sort((a, b) => {
    const la = lastByClient.get(a.id) ?? '' // null/missing → '' sorts first (NULLS FIRST = never-synced/most-stale)
    const lb = lastByClient.get(b.id) ?? ''
    if (la !== lb) return la < lb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return pending
}

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — atomic per-client claim under a DISTINCT '__fwd_'+platform namespace (never
// collides with the drain's '__drain_'+platform or the real '<platform>' cursor row; sync_state PK = client_id,platform).
// Reuses the migration-014/021 CAS RPC (480s self-healing lease). Loser/error → skip (client stays pending, retried next fire).
async function claimForward(platform: string, clientId: string): Promise<boolean> {
  const token = `fwd-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: claimRows, error } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId,
    p_platform: '__fwd_' + platform,
    p_token: token,
  })
  if (error) {
    console.error(`[cron/sync] forward claim failed platform=${platform} client=${clientId}: ${error.message}`)
    return false
  }
  const claim = Array.isArray(claimRows) ? (claimRows[0] as { claimed?: boolean }) : (claimRows as { claimed?: boolean })
  return Boolean(claim?.claimed)
}

// WS1a band-aid (maxDuration) SUPERSEDED by the WS1C-WIDE forward paging above: each platform loop now pages the
// least-recently-synced unsynced slice per fire under a '__fwd_'+platform claim/lease + FORWARD_BUDGET_MS, fired on a
// windowed */10 cadence — so a maxDuration kill can no longer drop the tail (the next fire resumes it). 800s = the
// verified Pro-Fluid ceiling already run in prod by the drain route (LORAMER_DRAIN_FREEMAX_V1). LORAMER_WS1C_WIDE_FORWARD_PAGING_V1.
export const maxDuration = 800

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
  const started = Date.now() // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire clock for FORWARD_BUDGET_MS paging

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
    .is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — archived clients: forward daily capture halts (history kept)

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
  const __pending = await pendingForwardClients('shopify', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!(await claimForward('shopify', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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
          captureDate,
          { throwOnError: true } // LORAMER_SHOPIFY_SWALLOW_FIX_V1 — halt on a real fetch error, never write a false-zero
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
  const __pending = await pendingForwardClients('meta', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!(await claimForward('meta', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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

        // LORAMER_META_BREADTH_FORWARD_V1 — forward capture for the 10 Meta breadth dimensions (device,
        // device_platform, age, gender, age_gender, action_type, video, geo_country, geo_region, hour) across all 4
        // entity levels. Closes G1: these dims had NO forward writer at all, so they froze at their drain's ship date
        // while clients kept spending (the drain's rangeLap only walks BACKWARD and can never reach today).
        // Each entry REUSES its existing range writer with startDate === endDate === captureDate — a one-day range —
        // so no row-building logic is duplicated and every guard (full pagination, FLAG-NOT-BLOCK reconcile, spend>0
        // filter, no fabricated keys) is inherited. Mirrors the Google breadth blocks above: own try/catch PER DIM so
        // one dim's failure logs LOUD and is recorded but NEVER drops the base rows, a sibling dim, or sync_state.
        // 0 rows = logged empty, not an error. No forward reconcile gate (the writers flag-not-block internally).
        //
        // PLACEMENT IS LOAD-BEARING — this block sits AFTER the base upsert (the reconcile anchor must exist) and
        // BEFORE the sync_state write below, exactly like Google (breadth :554-658 → sync_state :661). A client stays
        // PENDING until every dim has been attempted, so a maxDuration kill mid-breadth is retried on the next fire
        // instead of being silently marked synced. Do NOT move this below the sync_state write.
        for (const dim of META_BREADTH_FORWARD) {
          try {
            const { status, body } = await dim.run(client.id, captureDate, captureDate, {})
            if (status !== 200) {
              // The writers RETURN non-200 (they do not throw) for resolution/upsert failures — surface it LOUD
              // rather than treating a failed capture as a silent success (L63: a dead lap must never read green).
              const detail = JSON.stringify(body)
              console.error(`[cron/sync] client=${client.id} platform=meta ${dim.key} breadth capture FAILED (status ${status}):`, detail)
              summary.errors.push({ clientId: client.id, platform: 'meta', message: `${dim.key}: writer status ${status} — ${detail}` })
              continue
            }
            const written = Number(body?.written ?? 0)
            summary.rowsWritten += written
            if (written === 0) {
              console.log(`[cron/sync] client=${client.id} platform=meta ${dim.key} breadth capture: 0 rows (empty, not an error)`)
            }
          } catch (dimErr) {
            // A Meta Graph error propagates OUT of the writer (metaFetchAllPaged throws after its retry ladder is
            // exhausted — it never returns a silent partial). Catch it here so it cannot drop the base row.
            const message = serializeCaughtError(dimErr)
            console.error(`[cron/sync] client=${client.id} platform=meta ${dim.key} breadth capture FAILED:`, message)
            summary.errors.push({ clientId: client.id, platform: 'meta', message: `${dim.key}: ${message}` })
          }
        }

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
  const __pending = await pendingForwardClients('google', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!(await claimForward('google', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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

        // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — surface degraded Google sub-fetches (a query threw → returned []).
        // The base account/campaign rows are unaffected (campaigns throws → the outer catch, no cursor stamp); this
        // makes a PARTIAL capture VISIBLE in cron_runs.error_count instead of a silent false-zero. Cursor stamp unchanged.
        if (intel.fetchErrors && intel.fetchErrors.length > 0) {
          for (const fe of intel.fetchErrors) {
            console.error(`[cron/sync] client=${client.id} platform=google DEGRADED sub-fetch ${fe.label}: ${fe.message}`)
            summary.errors.push({ clientId: client.id, platform: 'google', message: `google fetch ${fe.label}: ${fe.message}` })
          }
        }

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
        // 4 entity grains (campaign/ad_group/ad/keyword × device). Writes all grains; no forward reconcile
        // (backfill/drain carry FLAG-NOT-BLOCK).
        try {
          let devRows = 0
          for (const grain of DEVICE_GRAINS) {
            const built = buildDeviceGrainRows(grain, client.id, userEmail, captureDate, customerId, await fetchDeviceGrainDay(grain, tokenRow.refresh_token, customerId, captureDate))
            if (built.length > 0) {
              const { error: devError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
              if (devError) throw devError
              summary.rowsWritten += built.length; devRows += built.length
            }
          }
          if (devRows === 0) {
            console.log(`[cron/sync] client=${client.id} platform=google device capture: 0 rows (empty, not an error)`)
          }
        } catch (devErr) {
          const message = serializeCaughtError(devErr)
          console.error(`[cron/sync] client=${client.id} platform=google device capture FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `device: ${message}` })
        }

        // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.1 + T0.2) — persist the conversion-action segmentation +
        // search impression-share families that fetchGoogleIntelligence ALREADY returned above
        // (intel.conversionsByCampaign / intel.impressionShares) — ZERO new Google calls (rides the existing
        // live-intel GAQL; the data was fetched for the Lora prompt and otherwise dropped). campaign grain only;
        // WRITE-ONLY (conversion_action Σ ≠ account by design; IS is a ratio, not a partition). HISTORY backfill
        // = T2.3 (quota-gated). Own try/catch: NEVER drops the platform's main / dimensional / device rows.
        try {
          const t0Rows = [
            ...buildGoogleConversionActionRows(client.id, userEmail, captureDate, customerId, intel.conversionsByCampaign),
            ...buildGoogleImpressionShareRows(client.id, userEmail, captureDate, customerId, intel.impressionShares),
          ]
          if (t0Rows.length > 0) {
            const { error: t0Error } = await supabaseAdmin
              .from('metrics_daily')
              .upsert(normalizeMetricsRows(t0Rows), { onConflict: METRICS_DAILY_CONFLICT })
            if (t0Error) throw t0Error
            summary.rowsWritten += t0Rows.length
          } else {
            console.log(`[cron/sync] client=${client.id} platform=google conv-action/IS persist: 0 rows (empty, not an error)`)
          }
        } catch (t0Err) {
          const message = serializeCaughtError(t0Err)
          console.error(`[cron/sync] client=${client.id} platform=google conv-action/IS persist FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `conv-action/IS: ${message}` })
        }

        // LORAMER_GOOGLE_GEO_CAPTURE_V1 — geo breakdown FAMILY (per-grain, both resources: 10 geographic_view +
        // 9 user_location_view = 19 queries/client/day). Own try/catch PER FAMILY (mirrors the device block): a
        // geo failure logs LOUD and is recorded, but NEVER drops base/dimensional/device rows or sync_state.
        // WRITE-ONLY — no reconcile (geo is non-partitioning: location_type overlap + multi-grain).
        for (const [famLabel, grains] of [['geo', GEOGRAPHIC_GRAINS], ['user_geo', USER_GRAINS]] as const) {
          try {
            let famRows = 0
            for (const grain of grains) {
              for (const entity of GEO_ENTITIES) {
                const built = buildGeoGrainRows(grain, entity, client.id, userEmail, captureDate, customerId, await fetchGeoGrainDay(grain, entity, tokenRow.refresh_token, customerId, captureDate))
                if (built.length > 0) {
                  const { error: geoError } = await supabaseAdmin
                    .from('metrics_daily')
                    .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                  if (geoError) throw geoError
                  summary.rowsWritten += built.length; famRows += built.length
                }
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

        // LORAMER_GOOGLE_HOUR_CAPTURE_V1 — hour breakdown (campaign×hour + ad_group×hour). Own try/catch: an hour
        // failure logs LOUD and is recorded, but NEVER drops base/dimensional/device/geo rows or sync_state.
        // Writes both grains; no forward reconcile (matches device/geo — the backfill carries FLAG-NOT-BLOCK).
        try {
          let hourRows = 0
          for (const grain of HOUR_GRAINS) {
            const built = buildHourGrainRows(grain, client.id, userEmail, captureDate, customerId, await fetchHourGrainDay(grain, tokenRow.refresh_token, customerId, captureDate))
            if (built.length > 0) {
              const { error: hourError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
              if (hourError) throw hourError
              summary.rowsWritten += built.length; hourRows += built.length
            }
          }
          if (hourRows === 0) {
            console.log(`[cron/sync] client=${client.id} platform=google hour capture: 0 rows (empty, not an error)`)
          }
        } catch (hourErr) {
          const message = serializeCaughtError(hourErr)
          console.error(`[cron/sync] client=${client.id} platform=google hour capture FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `hour: ${message}` })
        }

        // LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3) — age + gender breakdown (campaign + ad_group grains,
        // from age_range_view / gender_view). Closes G3: these views were ALREADY fetched for the Lora prompt and
        // dropped; now persisted. Own try/catch: a demographic failure logs LOUD and is recorded, but NEVER drops
        // base/dimensional/device/geo/hour rows or sync_state. ONE view fetch per dimension → both grains. No
        // forward reconcile (matches device/geo/hour — the backfill/drain carries FLAG-NOT-BLOCK).
        try {
          let demoRows = 0
          for (const dim of DEMO_DIMENSIONS) {
            const dayRows = await fetchDemographicDay(dim, tokenRow.refresh_token, customerId, captureDate)
            for (const grain of DEMO_GRAINS) {
              const built = buildDemographicGrainRows(dim, grain, client.id, userEmail, captureDate, customerId, dayRows)
              if (built.length > 0) {
                const { error: demoError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                if (demoError) throw demoError
                summary.rowsWritten += built.length; demoRows += built.length
              }
            }
          }
          if (demoRows === 0) {
            console.log(`[cron/sync] client=${client.id} platform=google demographic capture: 0 rows (empty, not an error)`)
          }
        } catch (demoErr) {
          const message = serializeCaughtError(demoErr)
          console.error(`[cron/sync] client=${client.id} platform=google demographic capture FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `demographic: ${message}` })
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
  const __pending = await pendingForwardClients('woocommerce', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!(await claimForward('woocommerce', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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

        // LORAMER_WOO_BATCH_WB_V1 — product_category/product_tag need the /wc/v3/products side-call, so
        // forward capture must pass a cache or the family would be BACKFILL-ONLY and freeze at its ship date
        // the moment forward moved past it (the G1 class this repo keeps rediscovering). One client, one day
        // → one id-batched, _fields-trimmed request (~321 bytes/product measured).
        const intel = await fetchWooCommerceIntelligence(
          tok.store_url,
          tok.consumer_key,
          tok.consumer_secret,
          'YESTERDAY',
          captureDate,
          captureDate,
          { productAttrCache: new Map() }
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
  const __pending = await pendingForwardClients('ga', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!(await claimForward('ga', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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

      // LORAMER_GA_FORWARD_DIM_LOOKBACK_V1 — forward dimensional breadth (families A–I) over a 7-DAY TRAILING WINDOW
      // ending at captureDate (was single-shot captureDate-only). GA4 dimensional data finalizes over 24-48h and
      // CHANGES during it, so each night we re-fetch the trailing window and UPSERT on the conflict key → finalized
      // values overwrite the intraday ones. This REPLACES the old (false) "self-heals on the ga_dimensional backfill
      // re-walk" claim: the backfill sets backfill_complete=true and returns early, so it NEVER re-walks recent days;
      // this trailing re-fetch is the actual self-correction. Still fully ISOLATED (its OWN try/catch): a failure
      // NEVER touches the account row / sync cursor / health already committed above — but it is now RECORDED to
      // cron_runs (via summary.errors → finalizeSection('ga') → error_count), not just a 1h console.warn.
      try {
        const dimStart = addDaysUTC(captureDate, -(GA_FORWARD_DIM_LOOKBACK_DAYS - 1)) // LORAMER_GA_FORWARD_DIM_LOOKBACK_V1
        const { rows: dimRows } = await fetchGaDimensionalRows({ clientId: client.id, userEmail, accessToken: gaToken.accessToken, propertyId: gaToken.gaPropertyId, propertyName: gaToken.gaPropertyName, startDate: dimStart, endDate: captureDate })
        if (dimRows.length > 0) {
          const { error: dimErr } = await supabaseAdmin.from('metrics_daily').upsert(normalizeMetricsRows(dimRows), { onConflict: METRICS_DAILY_CONFLICT })
          if (dimErr) throw dimErr
          summary.rowsWritten += dimRows.length
        }
      } catch (dimErr) {
        const message = serializeCaughtError(dimErr)
        console.warn(`[cron/sync] client=${client.id} GA dimensional forward (non-fatal): ${message}`)
        // LORAMER_GA_FORWARD_DIM_LOOKBACK_V1 — DURABLE record (was expiring in 1h). Identical pattern to the google
        // dimensional branch: pushing to summary.errors makes finalizeSection('ga') count it into cron_runs
        // error_count + connections_errored, so a failed forward-dim night is visible after the fact.
        summary.errors.push({ clientId: client.id, platform: 'ga', message: `dimensional forward: ${message}` })
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
