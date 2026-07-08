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
import { DEVICE_GRAINS, fetchDeviceGrainDay, buildDeviceGrainRows } from '@/lib/intelligence/google-device' // LORAMER_GOOGLE_DEVICE_CAPTURE_V1
import { buildGoogleConversionActionRows } from '@/lib/intelligence/google-conversion-action' // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1
import { buildGoogleImpressionShareRows } from '@/lib/intelligence/google-impression-share' // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1
import { GEOGRAPHIC_GRAINS, USER_GRAINS, GEO_ENTITIES, fetchGeoGrainDay, buildGeoGrainRows } from '@/lib/intelligence/google-geo' // LORAMER_GOOGLE_GEO_CAPTURE_V1
import { HOUR_GRAINS, fetchHourGrainDay, buildHourGrainRows } from '@/lib/intelligence/google-hour' // LORAMER_GOOGLE_HOUR_CAPTURE_V1
import { fetchWooCommerceIntelligence } from '@/lib/intelligence/woocommerce-intelligence'
import { fetchGaIntelligence } from '@/lib/intelligence/ga-intelligence'
import { getValidShopifyToken } from '@/lib/shopify-token'
import { getValidGaToken } from '@/lib/ga-token'
import { normalizeMetricsRows } from '@/lib/metrics-normalize'
import { detectTrigger, cronRunPlatforms, startCronRuns, finishCronRun } from '@/lib/cron-runs' // LORAMER_CRON_RUNS_SENTINEL_V1

const METRICS_DAILY_CONFLICT =
  'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'

const CATCHUP_WINDOW_DAYS = 35
const CATCHUP_DAY_CAP = 14

// WS1C-WIDE forward paging mirrored onto catchup: each platform loop pages the least-recently-SERVED slice per
// fire under a '__catchup_'+platform claim/lease + CATCHUP_BUDGET_MS, fired on a windowed */10 cadence — so the
// multi-day repair can no longer be dropped by a maxDuration kill (the next fire re-derives the remaining holes
// via computeFillDays; catchup keeps NO cursor, presence IS the resume signal). 800s = the verified Pro-Fluid
// ceiling the drain route already runs in prod (LORAMER_DRAIN_FREEMAX_V1). LORAMER_WS1C_WIDE_FORWARD_PAGING_V1.
export const maxDuration = 800

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire wall-clock budget (mirrors forward/drain; ~120s headroom under
// 800s so a whole-DAY fill that starts just under budget finishes before the ceiling).
const CATCHUP_BUDGET_MS = 680_000

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

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — catchup paging: the clients CONNECTED to `platform`, ordered
// LEAST-RECENTLY-SERVED first via the '__catchup_'+platform claim's backfill_claimed_at (NULLS FIRST =
// never-served), stable id tie-break (mirrors the drain's round-robin so no client's holes are ever starved).
// Catchup keeps NO durable cursor — computeFillDays re-derives the remaining holes each run, so this only decides
// ORDER + fairness. Connection source = platform_connections for all 5 (GA is present there too, verified).
async function pendingCatchupClients(platform: string, clientRows: ClientRow[]): Promise<ClientRow[]> {
  const connected = clientRows.filter(
    (c) => (c.platform_connections || []).some((pc) => pc.platform === platform)
  )
  if (connected.length === 0) return []
  const { data: claimRows } = await supabaseAdmin
    .from('sync_state')
    .select('client_id, backfill_claimed_at')
    .eq('platform', '__catchup_' + platform)
    .in('client_id', connected.map((c) => c.id))
  const claimedAt = new Map<string, string | null>()
  for (const r of claimRows || []) {
    claimedAt.set(
      (r as { client_id: string }).client_id,
      (r as { backfill_claimed_at: string | null }).backfill_claimed_at
    )
  }
  const ordered = [...connected]
  ordered.sort((a, b) => {
    const ta = claimedAt.get(a.id) ?? '' // null/never-served → '' sorts first (least-recently-served)
    const tb = claimedAt.get(b.id) ?? ''
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return ordered
}

// LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — atomic per-client claim under a DISTINCT '__catchup_'+platform namespace
// (4th sync_state PK, disjoint from '<platform>', '__fwd_'+platform, '__drain_'+platform). Reuses the migration-
// 014/021 CAS RPC (480s self-healing lease). Loser/error → skip (client's holes retried next fire, round-robin).
async function claimCatchup(platform: string, clientId: string): Promise<boolean> {
  const token = `catchup-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: claimRows, error } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId,
    p_platform: '__catchup_' + platform,
    p_token: token,
  })
  if (error) {
    console.error(`[cron/catchup] claim failed platform=${platform} client=${clientId}: ${error.message}`)
    return false
  }
  const claim = Array.isArray(claimRows) ? (claimRows[0] as { claimed?: boolean }) : (claimRows as { claimed?: boolean })
  return Boolean(claim?.claimed)
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
  const started = Date.now() // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire clock for CATCHUP_BUDGET_MS paging

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

  // LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1) — parse the platform gate + write started markers BEFORE
  // the clients query / heavy work; a crash or maxDuration kill leaves started rows with finished_at
  // NULL (the silent-hole signal). This also gives catchup its FIRST durable proof-of-run.
  const platform = (new URL(request.url).searchParams.get('platform') ?? 'all').trim().toLowerCase()
  const cronTrigger = detectTrigger(request)
  const cronRunIds = await startCronRuns({
    mode: 'catchup',
    platforms: cronRunPlatforms(platform),
    trigger: cronTrigger,
    windowStart,
    windowEnd: yesterday,
  })

  // Per-section finalize: derive this platform's tallies from the summary delta since the section
  // began (catchup also tracks accountsWithGaps + daysFilled), then stamp finished_at. Sections run
  // sequentially and tag errors by platform, so the delta belongs entirely to this section.
  const ATTEMPT_KEYS: Record<string, keyof typeof summary> = {
    shopify: 'shopifyConnections',
    meta: 'metaConnections',
    google: 'googleConnections',
    woocommerce: 'wooConnections',
    ga: 'gaConnections',
  }
  async function finalizeSection(
    p: string,
    snap: { rows: number; errs: number; gaps: number; days: number }
  ) {
    const errsForP = summary.errors.slice(snap.errs)
    const erroredConns = new Set(errsForP.map(e => e.clientId)).size
    const attempted = (summary[ATTEMPT_KEYS[p]] as number) ?? 0
    await finishCronRun(cronRunIds[p], {
      connectionsAttempted: attempted,
      connectionsErrored: erroredConns,
      connectionsSucceeded: Math.max(0, attempted - erroredConns),
      accountsWithGaps: summary.accountsWithGaps - snap.gaps,
      daysFilled: summary.daysFilled - snap.days,
      rowsWritten: summary.rowsWritten - snap.rows,
      errorCount: errsForP.length,
    })
  }

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

  // Same ?platform= gate as the forward cron (`platform` parsed above): no param / 'all' = all 5; else just that one.

  // ── SHOPIFY ──────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'shopify') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length, gaps: summary.accountsWithGaps, days: summary.daysFilled } // LORAMER_CRON_RUNS_SENTINEL_V1
  const __pending = await pendingCatchupClients('shopify', clientRows) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between CLIENTS
    if (!(await claimCatchup('shopify', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__catchup_' claim
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
        if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between DAYS
        try {
          const intel = await fetchShopifyIntelligence(accessToken, shopDomain, 'CUSTOM', d, d, { throwOnError: true }) // LORAMER_SHOPIFY_SWALLOW_FIX_V1
          const rows = buildShopifyMetricsRows(client.id, userEmail, d, shopDomain, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
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
                .upsert(normalizeMetricsRows(depthRows), { onConflict: METRICS_DAILY_CONFLICT })
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
  await finalizeSection('shopify', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }

  // ── META ─────────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'meta') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length, gaps: summary.accountsWithGaps, days: summary.daysFilled } // LORAMER_CRON_RUNS_SENTINEL_V1
  const __pending = await pendingCatchupClients('meta', clientRows) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between CLIENTS
    if (!(await claimCatchup('meta', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__catchup_' claim
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
        if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between DAYS
        try {
          const intel = await fetchMetaIntelligence(accessToken, accountId, 'CUSTOM', d, d)
          const rows = buildMetaMetricsRows(client.id, userEmail, d, accountId, conn.account_name, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
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
  await finalizeSection('meta', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }

  // ── GOOGLE ───────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'google') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length, gaps: summary.accountsWithGaps, days: summary.daysFilled } // LORAMER_CRON_RUNS_SENTINEL_V1
  const __pending = await pendingCatchupClients('google', clientRows) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between CLIENTS
    if (!(await claimCatchup('google', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__catchup_' claim
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
        if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between DAYS
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
          // LORAMER_WS1C_WIDE_SWALLOW_HARDEN_V1 — surface degraded Google sub-fetches (base rows unaffected —
          // campaigns throws; this makes a partial fill VISIBLE in cron_runs.error_count, not a silent false-zero).
          if (intel.fetchErrors && intel.fetchErrors.length > 0) {
            for (const fe of intel.fetchErrors) {
              console.error(`[cron/catchup] client=${client.id} platform=google ${d} DEGRADED sub-fetch ${fe.label}: ${fe.message}`)
              summary.errors.push({ clientId: client.id, platform: 'google', message: `google fetch ${fe.label} ${d}: ${fe.message}` })
            }
          }
          const rows = buildGoogleMetricsRows(client.id, userEmail, d, customerId, conn.account_name, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
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
                .upsert(normalizeMetricsRows(dimRows), { onConflict: METRICS_DAILY_CONFLICT })
              if (dimError) throw dimError
              summary.rowsWritten += dimRows.length
            }
          } catch (dimErr) {
            summary.errors.push({ clientId: client.id, platform: 'google', message: `dimensional ${d}: ${serializeCaughtError(dimErr)}` })
          }

          // Google device breakdown (campaign/ad_group/ad/keyword × device) — own try/catch, all 4 grains.
          try {
            for (const grain of DEVICE_GRAINS) {
              const built = buildDeviceGrainRows(grain, client.id, userEmail, d, customerId, await fetchDeviceGrainDay(grain, refreshToken, customerId, d))
              if (built.length > 0) {
                const { error: devError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                if (devError) throw devError
                summary.rowsWritten += built.length
              }
            }
          } catch (devErr) {
            summary.errors.push({ clientId: client.id, platform: 'google', message: `device ${d}: ${serializeCaughtError(devErr)}` })
          }

          // LORAMER_GOOGLE_CONV_ACTION_IS_PERSIST_V1 (T0.1 + T0.2) — persist conversion-action + impression-share
          // from the intel ALREADY fetched above (ZERO new Google calls; rides the live-intel GAQL). campaign
          // grain only; WRITE-ONLY (conv_action Σ ≠ account by design; IS is a ratio). HISTORY backfill = T2.3.
          try {
            const t0Rows = [
              ...buildGoogleConversionActionRows(client.id, userEmail, d, customerId, intel.conversionsByCampaign),
              ...buildGoogleImpressionShareRows(client.id, userEmail, d, customerId, intel.impressionShares),
            ]
            if (t0Rows.length > 0) {
              const { error: t0Error } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(t0Rows), { onConflict: METRICS_DAILY_CONFLICT })
              if (t0Error) throw t0Error
              summary.rowsWritten += t0Rows.length
            }
          } catch (t0Err) {
            summary.errors.push({ clientId: client.id, platform: 'google', message: `conv-action/IS ${d}: ${serializeCaughtError(t0Err)}` })
          }

          // Google geo breakdown FAMILY (per-grain, both resources) — own try/catch PER FAMILY. WRITE-ONLY.
          for (const [famLabel, grains] of [['geo', GEOGRAPHIC_GRAINS], ['user_geo', USER_GRAINS]] as const) {
            try {
              for (const grain of grains) {
                for (const entity of GEO_ENTITIES) {
                  const built = buildGeoGrainRows(grain, entity, client.id, userEmail, d, customerId, await fetchGeoGrainDay(grain, entity, refreshToken, customerId, d))
                  if (built.length > 0) {
                    const { error: geoError } = await supabaseAdmin
                      .from('metrics_daily')
                      .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                    if (geoError) throw geoError
                    summary.rowsWritten += built.length
                  }
                }
              }
            } catch (geoErr) {
              summary.errors.push({ clientId: client.id, platform: 'google', message: `${famLabel} ${d}: ${serializeCaughtError(geoErr)}` })
            }
          }

          // Google hour breakdown (campaign×hour + ad_group×hour) — own try/catch, mirrors device/geo. Both grains.
          try {
            for (const grain of HOUR_GRAINS) {
              const built = buildHourGrainRows(grain, client.id, userEmail, d, customerId, await fetchHourGrainDay(grain, refreshToken, customerId, d))
              if (built.length > 0) {
                const { error: hourError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                if (hourError) throw hourError
                summary.rowsWritten += built.length
              }
            }
          } catch (hourErr) {
            summary.errors.push({ clientId: client.id, platform: 'google', message: `hour ${d}: ${serializeCaughtError(hourErr)}` })
          }
        } catch (err) {
          summary.errors.push({ clientId: client.id, platform: 'google', message: `${d}: ${serializeCaughtError(err)}` })
          continue
        }
      }
    }
  }
  await finalizeSection('google', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }

  // ── WOOCOMMERCE ──────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'woocommerce') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length, gaps: summary.accountsWithGaps, days: summary.daysFilled } // LORAMER_CRON_RUNS_SENTINEL_V1
  const __pending = await pendingCatchupClients('woocommerce', clientRows) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between CLIENTS
    if (!(await claimCatchup('woocommerce', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__catchup_' claim
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
        if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between DAYS
        try {
          const intel = await fetchWooCommerceIntelligence(storeUrl, consumerKey, consumerSecret, 'CUSTOM', d, d)
          const rows = buildWooMetricsRows(client.id, userEmail, d, storeUrl, intel)
          const { error: metricsError } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
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
  await finalizeSection('woocommerce', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }

  // ── GA ───────────────────────────────────────────────────────────────────
  if (platform === 'all' || platform === 'ga') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length, gaps: summary.accountsWithGaps, days: summary.daysFilled } // LORAMER_CRON_RUNS_SENTINEL_V1
  const __pending = await pendingCatchupClients('ga', clientRows) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between CLIENTS
    if (!(await claimCatchup('ga', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__catchup_' claim
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
      if (Date.now() - started > CATCHUP_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — budget stop between DAYS
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
          .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
        if (metricsError) throw metricsError
        summary.rowsWritten += rows.length
        summary.daysFilled += 1
      } catch (err) {
        summary.errors.push({ clientId: client.id, platform: 'ga', message: `${d}: ${serializeCaughtError(err)}` })
        continue
      }
    }
  }
  await finalizeSection('ga', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }

  summary.clientsProcessed = processedClientIds.size
  return NextResponse.json(summary)
}
