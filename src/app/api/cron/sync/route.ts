// LORAMER_FORWARD_CAPTURE_CRON_V1
// Nightly forward-capture: yesterday's Shopify + Meta + Google metrics -> metrics_daily.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDateWindow } from '@/lib/date-range'
import { fetchShopifyIntelligenceByDay } from '@/lib/intelligence/shopify-intelligence' // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — Shopify Tier-1 21-day per-day re-sum
import { buildShopifyMetricsRows, buildShopifyDepthRows } from '@/lib/intelligence/shopify-metrics-row' // LORAMER_SHOPIFY_DEPTH_2A_V1
import { runMetaCampaignBackfill } from '@/lib/backfill/meta-campaign-backfill' // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Meta base Tier-1)
import { runMetaAdSetAdBackfill } from '@/lib/backfill/meta-adset-ad-backfill' // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Meta base Tier-1)
import { fetchGoogleAccountWindow, buildGoogleAccountRows } from '@/lib/intelligence/google-account-row' // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — the ONE account-row producer
import { runGoogleCampaignBackfill } from '@/lib/backfill/google-campaign-backfill' // LORAMER_GOOGLE_FORWARD_RESTATE_V1 (Google base Tier-1, mirrors Meta)
import { runGoogleAdGroupAdBackfill } from '@/lib/backfill/google-adgroup-ad-backfill' // LORAMER_GOOGLE_FORWARD_RESTATE_V1
import { buildWooMetricsRows } from '@/lib/intelligence/woocommerce-metrics-row'
import { fetchMetaDailyMetrics } from '@/lib/meta-ads' // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Meta base Tier-1 account grain)
import { META_BREADTH_FORWARD } from '@/lib/backfill/meta-breadth-forward' // LORAMER_META_BREADTH_FORWARD_V1 — forward capture for the 10 Meta breadth dims (G1)
import { fetchGoogleIntelligence } from '@/lib/intelligence/google-intelligence'
import { fetchGoogleDimensional, fetchGoogleDimensionalWindow, bucketWindowByDate, buildGoogleDimensionalRows } from '@/lib/intelligence/google-dimensional' // LORAMER_SEARCH_TERMS_CAPTURE_V1 + LORAMER_GOOGLE_FORWARD_RESTATE_V1
import { DEVICE_GRAINS, fetchDeviceGrainWindow, buildDeviceGrainRows } from '@/lib/intelligence/google-device' // LORAMER_GOOGLE_DEVICE_CAPTURE_V1
import { GEOGRAPHIC_GRAINS, USER_GRAINS, GEO_ENTITIES, fetchGeoGrainWindow, buildGeoGrainRows } from '@/lib/intelligence/google-geo' // LORAMER_GOOGLE_GEO_CAPTURE_V1
import { HOUR_GRAINS, fetchHourGrainWindow, buildHourGrainRows } from '@/lib/intelligence/google-hour' // LORAMER_GOOGLE_HOUR_CAPTURE_V1
import { DEMO_DIMENSIONS, DEMO_GRAINS, fetchDemographicWindow, buildDemographicGrainRows } from '@/lib/intelligence/google-demographic' // LORAMER_GOOGLE_DEMOGRAPHIC_CAPTURE_V1 (G-FILL#3)
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
import { upsertMetricsChunked } from '@/lib/metrics-upsert' // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — a 31-day pass can exceed the PostgREST statement ceiling; new sites pay the debt rather than joining the allowlist
import { pruneCappedDimensionalRows, cappedRowKey } from '@/lib/intelligence/google-dimensional-prune' // LORAMER_GOOGLE_RESTATE_PRUNE_V1 — upsert-then-prune, the only destructive write in the Google capture path
import { detectTrigger, cronRunPlatforms, startCronRuns, finishCronRun, progressCronRun } from '@/lib/cron-runs' // LORAMER_CRON_RUNS_SENTINEL_V1 + LORAMER_FORWARD_LANE_HYGIENE_V1
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
// LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — Meta Tier-1 breadth restatement window (per LORAMER_RESTATEMENT_WINDOW_LAW_V1:
// Meta 9d min). Each forward fire re-walks the last 9 days of the Meta BREADTH writers so late-attributed conversions
// (which keep maturing for up to the account's attribution window) restate; the upsert REPLACES per the date-keyed
// conflict key, so re-walking a day overwrites it — never additive. BASE rows are NOT covered by this (see the note
// at the dim loop): the base path aggregates a period and stamps one date, so it needs a separate per-day change.
const META_RESTATE_LOOKBACK_DAYS = 9
// LORAMER_GOOGLE_FORWARD_RESTATE_V1 — Google forward restatement window. THE ONE NAMED SOURCE for this depth.
//
// ⛔ DERIVED FROM MEASURED DRIFT, NOT FROM A PUBLISHED FIGURE. 2026-08-24, three clients × 90 days, what
// forward capture stored at T+1 versus what the vendor returns today, pooled by day age:
//   share of client-days still changing   1-3 / 4-7 / 8-14 / 15-30 / 31-60 / 61-90
//     conversions                          78%   58%   62%    60%    32%     30%
//     spend                                22%   33%   29%    52%    20%     17%
//   median size among changing days (conv) 10.5% 150%  85.7%  50%    14.3%   7.9%
// THE KNEE IS AT 30 AND IT IS SHARP: crossing day 30 the share of moving days HALVES (60% -> 32%) and the
// typical size drops 3.5x (50% -> 14.3%). Every bucket at or below 30 has >=50% of days still moving.
// AGAINST MEASURED WRITE COST: forward writes ~81,132 Google rows/day fleet-wide at depth 1, one completed
// pass per client per day. Depth 30 ~= 2.43M row-writes/day; 60 doubles it to recover days moving by a
// median 14.3%; 90 triples it for 7.9%. 30 buys the whole high-movement band at a third of the ceiling.
// NOT chosen because 90 was available.
// ⛔ THE DEPTH IS A PLATFORM PROPERTY, NEVER A PER-ACCOUNT ONE. Spend and clicks restate on accounts with
// ZERO counting conversion actions (6679594156 has 13 enabled actions, not one counting), so a depth
// derived from conversion windows would never re-ask them and would leave their spend wrong.
// google-forward-must-restate.guard.mjs fails the build if anyone ever gates this on conversion setup.
// VENDOR COST: zero added requests for the six breadth families — a ranged GAQL costs the same as a single
// day. The account writer adds ONE ranged query per client per fire (18/day against a 15,000/day lane).
const GOOGLE_RESTATE_LOOKBACK_DAYS = 30
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
// Reuses the migration-014/021 CAS RPC; LORAMER_FORWARD_LANE_HYGIENE_V1 (migration 086) made the self-healing lease a
// parameter and forward passes FORWARD_CLAIM_LEASE_S (= maxDuration + 100, declared beside maxDuration below) — the
// 480 s default was sized for a ~340 s Woo lap and lapsed under a 644-662 s google pass (measured 2026-09-05 on
// client c39ee088, registry src/lib/clients/canonical.ts), letting the next fire re-claim a client mid-pass.
// Loser/error → skip (client stays pending, retried next fire).
async function claimForward(platform: string, clientId: string): Promise<boolean> {
  const token = `fwd-${platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: claimRows, error } = await supabaseAdmin.rpc('claim_backfill_cursor', {
    p_client_id: clientId,
    p_platform: '__fwd_' + platform,
    p_token: token,
    p_lease_seconds: FORWARD_CLAIM_LEASE_S, // LORAMER_FORWARD_LANE_HYGIENE_V1 — migration 086; 3-arg callers keep the 480 s default
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
// LORAMER_FORWARD_LANE_HYGIENE_V1 — THE FORWARD CLAIM LEASE IS DERIVED FROM maxDuration, HERE, NEVER A LITERAL.
// A Vercel invocation is terminated at maxDuration, so a holder's hold from its claim is ≤ maxDuration; a lease of
// maxDuration + margin therefore cannot lapse under a live holder. The 100 s margin covers a write issued in the
// last second before the kill landing at PostgREST. MEASURED 2026-09-05: the RPC's 480 s default (migration 021,
// sized for a ~340 s Woo lap) lapsed under a 644-662 s google pass on Escential, and the 08:58Z and 09:08Z fires
// wrote the same client concurrently. Guard: tests/guards/forward-claim-lease-covers-max-duration.guard.mjs.
const FORWARD_CLAIM_LEASE_S = maxDuration + 100

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
    // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — per-platform count of connections that CAPTURED but had a partial /
    // sub-fetch failure. Distinct from errored (the connection failed) and from succeeded. Surfaced, never hidden.
    degraded: {} as Record<string, number>,
  }
  // LORAMER_CRON_DISTINCT_COUNT_V1 — FIX 5: clientsProcessed is one Set of distinct client ids
  // across the five per-platform loops, not five separate +=1 (which counted a multi-platform
  // client once per platform). Cosmetic; no behavior change.
  const processedClientIds = new Set<string>()

  // LORAMER_CRON_RUNS_SENTINEL_V1 (WS1b-1) — parse the platform gate + write started markers
  // BEFORE the clients query / heavy work, so a crash or maxDuration kill still leaves a started
  // row with finished_at NULL (the silent-hole signal). Observability only; never throws.
  const platform = (new URL(request.url).searchParams.get('platform') ?? 'all').trim().toLowerCase()
  // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — Shopify forward Tier-1 restatement controls. dryRun re-sums the
  // trailing window against live Shopify WITHOUT any write (no metrics upsert, no claim, no cursor, no
  // health), scoped to `client` (CSV); it early-returns a per-day would-write report. Production writes.
  // SHOPIFY_FWD_RESTATE_DAYS is the trailing window the forward pass re-sums and REPLACEs day-by-day.
  const gForwardParams = new URL(request.url).searchParams
  const gDryRun = gForwardParams.get('dryRun') === 'true'
  const gOnlyClients = (gForwardParams.get('client') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const SHOPIFY_FWD_RESTATE_DAYS = 21 // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — Shopify Tier-1 trailing re-sum window (day-level REPLACE)
  const gWidenReport: Array<Record<string, unknown>> = []
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
  // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — `${platform}|${clientId}` for connections whose CONNECTION failed, i.e.
  // the platform's OUTER catch fired. Only these may count as errored. Everything else pushed into summary.errors
  // comes from a family/sub-fetch try/catch that exists SPECIFICALLY so a partial failure never drops the
  // connection — those are DEGRADATIONS and must not be reported as connection failures.
  const connFailed = new Set<string>()
  // LORAMER_FORWARD_LANE_HYGIENE_V1 — ONE arithmetic for a section's tallies, read at two moments: after every
  // client (progressSection → progressCronRun, no finished_at) and at the end (finalizeSection → finishCronRun).
  // A maxDuration kill runs no code, so the progress row is the ONLY record a killed fire can leave — measured
  // 2026-09-05: 26 of 541 google forward fires in 30 days were killed after writing rows and stamping cursors, and
  // every one read attempted 0 / rows 0 because the single tally write sat after the whole loop.
  function sectionTallies(p: string, snap: { rows: number; errs: number }) {
    const errsForP = summary.errors.slice(snap.errs)
    // THE BUG THIS FIXES, measured 2026-07-27: the google 08:08 run reported 17 attempted / 0 succeeded / 17
    // errored WHILE WRITING 77,647 ROWS. Every client logged two DEGRADED sub-fetches (audience, conversion_action),
    // and `new Set(errsForP.map(e => e.clientId)).size` counted each of them as a failed connection. Three days of
    // "google forward is dead" alarm off a successful run. A degraded sub-fetch is a partial-capture warning.
    const clientsWithEntries = [...new Set(errsForP.map((e) => e.clientId))]
    const erroredConns = clientsWithEntries.filter((id) => connFailed.has(`${p}|${id}`)).length
    const degradedConns = clientsWithEntries.filter((id) => !connFailed.has(`${p}|${id}`)).length
    const attempted = (summary[ATTEMPT_KEYS[p]] as number) ?? 0
    return { errsForP, erroredConns, degradedConns, attempted, rows: summary.rowsWritten - snap.rows }
  }
  // Per-client progress stamp. NEVER sets finished_at — a progress row is evidence of work, not a completion claim.
  async function progressSection(p: string, snap: { rows: number; errs: number }) {
    const t = sectionTallies(p, snap)
    await progressCronRun(cronRunIds[p], {
      connectionsAttempted: t.attempted,
      connectionsErrored: t.erroredConns,
      connectionsSucceeded: Math.max(0, t.attempted - t.erroredConns),
      rowsWritten: t.rows,
      errorCount: t.errsForP.length,
    })
  }
  async function finalizeSection(p: string, snap: { rows: number; errs: number }) {
    const { errsForP, erroredConns, degradedConns, attempted, rows } = sectionTallies(p, snap)
    // DEGRADED IS SURFACED, NEVER HIDDEN — it is why conversion_action and audience are thin. It rides the JSON
    // summary + the log rather than cron_runs, because cron_runs has no column for it and this flight adds no schema.
    summary.degraded[p] = degradedConns
    if (degradedConns > 0) {
      console.warn(`[cron/sync] platform=${p} DEGRADED connections=${degradedConns} (partial capture; NOT connection failures) · failed=${erroredConns} · succeeded=${Math.max(0, attempted - erroredConns)}`)
    }
    await finishCronRun(cronRunIds[p], {
      connectionsAttempted: attempted,
      connectionsErrored: erroredConns,
      connectionsSucceeded: Math.max(0, attempted - erroredConns),
      rowsWritten: rows,
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
  const sStart = addDaysUTC(captureDate, -SHOPIFY_FWD_RESTATE_DAYS) // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — trailing 21-day re-sum window start (declared before the try: the dry-run report below reads it)
  // LORAMER_FORWARD_LANE_HYGIENE_V1 — finalizeSection runs in the finally: a THROW anywhere in the section stamps
  // finished_at. A maxDuration kill still cannot — no code runs after it — and the per-client progressSection stamp
  // inside the loop is what survives a kill (26 of 541 google forward fires in 30 days read attempted 0 / rows 0
  // after writing rows and stamping cursors, measured 2026-09-05).
  try {
  // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — a dry-run scopes to the requested clients (no cursor dependence) and never claims.
  const __pending = gDryRun
    ? clientRows.filter((c) => gOnlyClients.includes(c.id))
    : await pendingForwardClients('shopify', clientRows, captureDate) // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1
  for (const client of __pending) {
    if (!gDryRun && Date.now() - started > FORWARD_BUDGET_MS) break // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — per-fire budget
    if (!gDryRun && !(await claimForward('shopify', client.id))) continue // LORAMER_WS1C_WIDE_FORWARD_PAGING_V1 — '__fwd_' claim
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

        // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Shopify Tier-1) — re-sum the trailing 21 days by created_at every run and
        // upsert-REPLACE each day's account + depth rows (7-col conflict key). ONE window fetch + hoisted sub-fetches
        // (fetchShopifyIntelligenceByDay) → NOT 21 per-day fetches. Net is re-derived from CURRENT refund-adjusted money
        // (currentSubtotalPriceSet / totalRefundedSet), so refunds/edits/cancels that landed since original capture are
        // picked up and REPLACE the stored day. Account main row + depth keep their separate try/catch per day.
        const byDay = await fetchShopifyIntelligenceByDay(tokenResult.accessToken, shopDomain, sStart, captureDate, { throwOnError: true })

        // dry-run only: read the currently-stored account net per day to SHOW drift (unchanged → same net; a late refund → moves).
        const storedNetByDay: Record<string, number> = {}
        if (gDryRun) {
          const { data: storedRows } = await supabaseAdmin
            .from('metrics_daily').select('date, revenue')
            .eq('client_id', client.id).eq('platform', 'shopify').eq('entity_level', 'account')
            .eq('breakdown_type', '').eq('breakdown_value', '').gte('date', sStart).lte('date', captureDate)
          for (const r of storedRows || []) storedNetByDay[String((r as any).date)] = Number((r as any).revenue) || 0
        }

        let shopWritten = 0
        const sDays: Array<Record<string, unknown>> = []
        for (const [day, intel] of byDay) {
          const rows = buildShopifyMetricsRows(client.id, userEmail, day, shopDomain, intel)
          if (rows.length > 0) {
            if (!gDryRun) {
              const { error: metricsError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(rows), { onConflict: METRICS_DAILY_CONFLICT })
              if (metricsError) throw metricsError
            }
            shopWritten += rows.length
          }
          // LORAMER_SHOPIFY_DEPTH_2A_V1 — depth in its OWN try/catch PER DAY: a depth failure logs LOUD + is recorded,
          // but never drops that day's account row. 0 rows = logged empty (not error).
          try {
            const depthRows = buildShopifyDepthRows(client.id, userEmail, day, shopDomain, intel)
            if (intel.unknownGeoOrders) {
              console.warn(`[cron/sync] client=${client.id} platform=shopify day=${day} geo UNKNOWN-address orders=${intel.unknownGeoOrders}`)
            }
            if (depthRows.length > 0) {
              if (!gDryRun) {
                const { error: depthError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(depthRows), { onConflict: METRICS_DAILY_CONFLICT })
                if (depthError) throw depthError
              }
              shopWritten += depthRows.length
            }
            if (gDryRun) {
              const resummedNet = Number((intel.totalRevenue ?? 0).toFixed(2))
              const sumProductNet = Number((intel.productsCapture || []).reduce((s: number, p: { netRevenue?: number }) => s + (p.netRevenue ?? 0), 0).toFixed(2))
              const stored = storedNetByDay[day]
              sDays.push({
                day,
                resummedNet,
                storedNet: stored === undefined ? null : Number(stored.toFixed(2)),
                deltaVsStored: stored === undefined ? null : Number((resummedNet - stored).toFixed(2)),
                sumProductNet,
                reconcileOk: Math.abs(resummedNet - sumProductNet) < 0.02, // Σ product net ≡ account net (partition)
                depthRows: depthRows.length,
              })
            }
          } catch (depthErr) {
            const message = serializeCaughtError(depthErr)
            console.error(`[cron/sync] client=${client.id} platform=shopify day=${day} depth capture FAILED:`, message)
            summary.errors.push({ clientId: client.id, platform: 'shopify', message: `depth ${day}: ${message}` })
          }
        }
        if (!gDryRun) summary.rowsWritten += shopWritten
        else gWidenReport.push({
          client: client.id, shopDomain, family: 'shopify-resum', window: `${sStart} → ${captureDate}`,
          days: byDay.size, wouldWriteRows: shopWritten,
          reconcileAllOk: sDays.every((d) => d.reconcileOk !== false),
          driftDays: sDays.filter((d) => d.deltaVsStored != null && Math.abs(d.deltaVsStored as number) > 0.01)
            .map((d) => ({ day: d.day, storedNet: d.storedNet, resummedNet: d.resummedNet, delta: d.deltaVsStored })),
          sampleDays: sDays.slice(-6),
        })

        // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — a dry-run writes NOTHING: no cursor advance, no connection-health stamp.
        if (!gDryRun) {
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
        }
      } catch (err) {
        const message = serializeCaughtError(err)
        console.error(
          `[cron/sync] client=${client.id} platform=shopify shop=${shopDomain}:`,
          message
        )
        connFailed.add('shopify|' + client.id) // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — the CONNECTION failed (outer catch), not a sub-fetch
        summary.errors.push({
          clientId: client.id,
          platform: 'shopify',
          message,
        })
        // LORAMER_CONNECTION_HEALTH_V1 — AUTH-class only; transient/empty leaves health untouched.
        if (!gDryRun) await recordConnectionResult({ platform: 'shopify', clientId: client.id, accountId: shopDomain, userEmail, error: err }) // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — no health write in dry-run
      }
    }
    await progressSection('shopify', __snap) // LORAMER_FORWARD_LANE_HYGIENE_V1 — tallies so far; the only record a kill leaves
  }
  } finally {
    await finalizeSection('shopify', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }
  // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 — a Shopify dry-run short-circuits here with the per-day re-sum report (no meta/google/woo; no writes anywhere above).
  if (gDryRun) {
    return NextResponse.json({
      dryRun: true,
      platform: 'shopify',
      captureDate,
      window: `${sStart} → ${captureDate}`,
      restateDays: SHOPIFY_FWD_RESTATE_DAYS,
      clients: gOnlyClients,
      note: 'Shopify Tier-1 21-day re-sum (per created_at day; account + depth REPLACE on the 7-col key). Net re-derived from CURRENT refund-adjusted money (currentSubtotalPriceSet / totalRefundedSet). Zero rows written.',
      shopifyResum: gWidenReport,
      errors: summary.errors,
    })
  }
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end shopify guard

  if (platform === 'all' || platform === 'meta') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  try { // LORAMER_FORWARD_LANE_HYGIENE_V1 — finalize in the finally (a throw stamps; a kill cannot — the per-client progressSection stamp is what survives it)
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

        // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Meta Tier-1 BASE — Approach B) — restate the last
        // META_RESTATE_LOOKBACK_DAYS of BASE rows (account/campaign/adset/ad, breakdown_type='') so late-attributed
        // conversions + any under-captured spend restate. This REPLACES the single-shot
        // fetchMetaIntelligence(captureDate,captureDate) base: that path AGGREGATES a period into ONE summary and
        // buildMetaMetricsRows stamps one date, so it cannot be range-widened; these per-day range writers can.
        // ORDER IS LOAD-BEARING: account rows go FIRST — the campaign/adset/ad writers FLAG-NOT-BLOCK reconcile each
        // day against that day's account anchor. TRADEOFF (accepted per Approach B): the account grain comes from
        // fetchMetaDailyMetrics, which is leaner than buildMetaMetricsRows — its derived metrics are RECOMPUTED here
        // and account-grain reach/frequency/purchases are dropped (they remain captured at campaign grain by the
        // writer below, and placement is captured by the widened META_BREADTH_FORWARD 'placement_adset_ad' dim).
        const metaRestateStart = addDaysUTC(captureDate, -META_RESTATE_LOOKBACK_DAYS)

        // (1) ACCOUNT grain — per-day rows via fetchMetaDailyMetrics (time_increment=1). Upsert REPLACES per the
        // date-keyed conflict key (never additive).
        const dailyAcct = await fetchMetaDailyMetrics(tokenRow.access_token, accountId, metaRestateStart, captureDate)
        const acctRows = dailyAcct.map((d) => {
          const ctr = d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0
          const cpc = d.clicks > 0 ? d.cost / d.clicks : null
          const cpm = d.impressions > 0 ? (d.cost / d.impressions) * 1000 : null
          const roas = d.cost > 0 ? d.conversionValue / d.cost : null
          const cpa = d.conversions > 0 ? d.cost / d.conversions : null
          const convRate = d.clicks > 0 ? d.conversions / d.clicks : null
          return {
            client_id: client.id, user_email: userEmail, platform: 'meta', account_id: accountId,
            entity_level: 'account', entity_id: accountId, entity_name: conn.account_name || accountId,
            date: d.date, breakdown_type: '', breakdown_value: '',
            spend: d.cost, impressions: d.impressions, clicks: d.clicks,
            conversions: d.conversions, conversion_value: d.conversionValue, revenue: 0,
            extra: {
              ctr, cpc, cpm, roas, cpa, convRate,
              cpp: d.reach > 0 ? (d.cost / d.reach) * 1000 : null, // Meta cpp = cost per 1,000 people reached
              reach: d.reach, frequency: d.frequency,
              outboundClicks: d.outboundClicks, inlineLinkClicks: d.inlineLinkClicks,
              uniqueClicks: d.uniqueClicks, uniqueClicksBasis: 'meta_native_deduplicated', // account-NATIVE, not the summed-campaign upper bound
              uniqueInlineLinkClicks: d.uniqueInlineLinkClicks, uniqueOutboundClicks: d.uniqueOutboundClicks,
              purchases: d.purchases, addToCart: d.addToCart, initiateCheckout: d.initiateCheckout, viewContent: d.viewContent,
              costPerPurchase: d.costPerPurchase, costPerAddToCart: d.costPerAddToCart,
              attributionSetting: d.attributionSetting,
              restated: true,
            },
          }
        })
        if (acctRows.length > 0) {
          const { error: acctErr } = await supabaseAdmin
            .from('metrics_daily')
            .upsert(normalizeMetricsRows(acctRows), { onConflict: METRICS_DAILY_CONFLICT })
          if (acctErr) throw acctErr
          summary.rowsWritten += acctRows.length
        }

        // (2) CAMPAIGN + (3) AD_SET/AD grains over the SAME window — the depth range writers (self-contained: fetch
        // their own token/account, walk the explicit range via monthChunks, bucket per-day, carry the FULL extra shape
        // incl. reach/frequency/ranking/click-variants, and FLAG-NOT-BLOCK reconcile to the account anchor written
        // above). Own try/catch each so one grain's failure never drops the others or the account rows.
        try {
          const r = await runMetaCampaignBackfill(client.id, metaRestateStart, captureDate, {})
          if (r.status !== 200) { console.error(`[cron/sync] client=${client.id} meta base campaign restate FAILED (${r.status}):`, JSON.stringify(r.body)); summary.errors.push({ clientId: client.id, platform: 'meta', message: `base-campaign: status ${r.status}` }) }
          else summary.rowsWritten += Number((r.body as any)?.written ?? 0)
        } catch (e) { const message = serializeCaughtError(e); console.error(`[cron/sync] client=${client.id} meta base campaign restate FAILED:`, message); summary.errors.push({ clientId: client.id, platform: 'meta', message: `base-campaign: ${message}` }) }
        try {
          const r = await runMetaAdSetAdBackfill(client.id, metaRestateStart, captureDate, {})
          if (r.status !== 200) { console.error(`[cron/sync] client=${client.id} meta base adset/ad restate FAILED (${r.status}):`, JSON.stringify(r.body)); summary.errors.push({ clientId: client.id, platform: 'meta', message: `base-adset-ad: status ${r.status}` }) }
          else summary.rowsWritten += Number((r.body as any)?.written ?? 0)
        } catch (e) { const message = serializeCaughtError(e); console.error(`[cron/sync] client=${client.id} meta base adset/ad restate FAILED:`, message); summary.errors.push({ clientId: client.id, platform: 'meta', message: `base-adset-ad: ${message}` }) }

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
        // LORAMER_RESTATEMENT_SWEEP_FLEET_V1 (Meta Tier 1) — widen each breadth writer from a single day to the last
        // META_RESTATE_LOOKBACK_DAYS. These dims ARE the range backfill writers (meta-breadth-forward.ts): they walk a
        // range, bucket per-day (Meta insights time_increment=1), and FLAG-NOT-BLOCK reconcile each day against that
        // day's account anchor — so a range is safe + idempotent, and re-emitting a day upsert-REPLACES it (date is in
        // the conflict key), never accumulates. NOTE the BASE rows above stay single-day ON PURPOSE: fetchMetaIntelligence
        // AGGREGATES a period and buildMetaMetricsRows stamps one captureDate, so range-widening the base there would
        // write summed spend onto one date — base restatement is a separate change, held.
        for (const dim of META_BREADTH_FORWARD) {
          try {
            const { status, body } = await dim.run(client.id, addDaysUTC(captureDate, -META_RESTATE_LOOKBACK_DAYS), captureDate, {})
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
        connFailed.add('meta|' + client.id) // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — the CONNECTION failed (outer catch), not a sub-fetch
        summary.errors.push({
          clientId: client.id,
          platform: 'meta',
          message,
        })
        // LORAMER_CONNECTION_HEALTH_V1 — Meta code-190 flips the whole FB-token credential.
        await recordConnectionResult({ platform: 'meta', clientId: client.id, accountId, userEmail, error: err })
      }
    }
    await progressSection('meta', __snap) // LORAMER_FORWARD_LANE_HYGIENE_V1 — tallies so far; the only record a kill leaves
  }
  } finally {
    await finalizeSection('meta', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end meta guard

  if (platform === 'all' || platform === 'google') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  try { // LORAMER_FORWARD_LANE_HYGIENE_V1 — finalize in the finally (a throw stamps; a kill cannot — the per-client progressSection stamp is what survives it)
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

        // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — BASE GRAINS OVER THE RESTATE WINDOW, mirroring the Meta shape
        // above (sync Meta base + campaign/adset/ad backfills over metaRestateStart..captureDate).
        // This REPLACES the single-shot buildGoogleMetricsRows(intel) write: that builder stamps ONE
        // captureDate for a payload fetchGoogleIntelligence AGGREGATED over the range, so it could not be
        // widened without writing a multi-day sum onto one day. `intel` is still fetched at captureDate
        // above and still used below for conversionsByCampaign / impressionShares / fetchErrors.
        //
        // ⛔ ORDER IS LOAD-BEARING, exactly as it is for Meta. The ACCOUNT rows go FIRST: both
        // google-campaign-backfill (posture 'block') and google-adgroup-ad-backfill anchor their per-day
        // reconcile on that day's account row. Writing them out of order reconciles against a stale or
        // absent anchor and silently skips days.
        const googleRestateStart = addDaysUTC(captureDate, -GOOGLE_RESTATE_LOOKBACK_DAYS)

        // (1) ACCOUNT grain — the ONE producer, from Google's own account report. Independent of the
        // campaign fetch by design, which is what keeps the two reconcilers below meaningful.
        const acctDays = await fetchGoogleAccountWindow(tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
        const rows = buildGoogleAccountRows(client.id, userEmail, customerId, conn.account_name, acctDays, 'forward') // LORAMER_ACCOUNT_ROW_PROVENANCE_V1 — the lane, as a literal
        // Chunked: 31 days x every Google connection is materially more rows per statement than the
        // single-day write this replaced, and an unchunked upsert fails at the PostgREST ceiling by SIZE.
        if (rows.length > 0) await upsertMetricsChunked(rows)
        summary.rowsWritten += rows.length

        // (2) CAMPAIGN and (3) AD_GROUP/AD grains — the existing range writers, over the same window.
        // Own try/catch each: a base-grain restatement failure must not drop the account rows already
        // written or the breadth families below. Same posture as the Meta calls at sync:533/538.
        try {
          const rCamp = await runGoogleCampaignBackfill(client.id, googleRestateStart, captureDate, {})
          if (rCamp.status >= 400) {
            console.error(`[cron/sync] client=${client.id} platform=google campaign restate ${rCamp.status}:`, JSON.stringify(rCamp.body).slice(0, 300))
            summary.errors.push({ clientId: client.id, platform: 'google', message: `campaign restate ${rCamp.status}` })
          } else {
            summary.rowsWritten += Number((rCamp.body as any)?.written ?? 0)
          }
        } catch (campErr) {
          const message = serializeCaughtError(campErr)
          console.error(`[cron/sync] client=${client.id} platform=google campaign restate FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `campaign restate: ${message}` })
        }
        try {
          const rAga = await runGoogleAdGroupAdBackfill(client.id, googleRestateStart, captureDate, {})
          if (rAga.status >= 400) {
            console.error(`[cron/sync] client=${client.id} platform=google adgroup/ad restate ${rAga.status}:`, JSON.stringify(rAga.body).slice(0, 300))
            summary.errors.push({ clientId: client.id, platform: 'google', message: `adgroup/ad restate ${rAga.status}` })
          } else {
            summary.rowsWritten += Number((rAga.body as any)?.written ?? 0)
          }
        } catch (agaErr) {
          const message = serializeCaughtError(agaErr)
          console.error(`[cron/sync] client=${client.id} platform=google adgroup/ad restate FAILED:`, message)
          summary.errors.push({ clientId: client.id, platform: 'google', message: `adgroup/ad restate: ${message}` })
        }

        // LORAMER_SEARCH_TERMS_CAPTURE_V1 — dimensional capture (search terms + keywords) as
        // breakdown rows. Own try/catch: a dimensional failure logs LOUD and is recorded, but never
        // drops the platform's main rows or its sync_state write. 0 rows = logged empty, not error.
        try {
          // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — ranged window + per-day buckets. bucketWindowByDate applies
          // the SAME per-day top-N (by cost) as the single-day path, so each day's rows are shape-identical
          // to what forward used to write. On WINDOW_ROW_CAP overflow the window is refused and we fall back
          // to the single captureDate rather than storing a silently truncated range.
          // ⛔ CORRECTED 2026-08-25 (LORAMER_GOOGLE_RESTATE_PRUNE_V1): this comment used to end "a re-pull
          // REPLACES that day rather than interleaving a range-wide top-N". The top-N BASIS claim was true;
          // the REPLACES claim was not. upsertMetricsChunked replaces only keys that RECUR, so a term that
          // fell out of the moved top-N kept its first-pull row and the day read as old ∪ new. The prune
          // below is what makes the word "replaces" true, and it runs AFTER the writes, never before.
          const dimFreshKeys = new Set<string>()
          const dimPrunableDates: string[] = []
          const dimWin = await fetchGoogleDimensionalWindow(tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
          const dimBuckets = dimWin.overflow ? new Map() : bucketWindowByDate(dimWin)
          if (dimWin.overflow) {
            console.warn(`[cron/sync] client=${client.id} platform=google dimensional WINDOW OVERFLOW (>= row cap) over ${googleRestateStart}..${captureDate} — falling back to captureDate only`)
          }
          const dim = dimWin.overflow
            ? await fetchGoogleDimensional(tokenRow.refresh_token, customerId, captureDate, captureDate)
            : (dimBuckets.get(captureDate) ?? { searchTerms: [], keywords: [], searchTermsTruncated: false, keywordsTruncated: false })
          for (const [dimDate, dimDay] of dimBuckets) {
            if (dimDate === captureDate) continue
            const built = buildGoogleDimensionalRows(client.id, userEmail, dimDate, customerId, dimDay)
            if (built.length === 0) continue
            await upsertMetricsChunked(built)
            summary.rowsWritten += built.length
            // Only a day that PRODUCED rows becomes prunable — see google-dimensional-prune.ts's
            // conservatism note. A day the vendor answered with nothing keeps what it holds.
            dimPrunableDates.push(dimDate)
            for (const b of built) dimFreshKeys.add(cappedRowKey(b as any))
          }
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
            dimPrunableDates.push(captureDate)
            for (const b of dimRows) dimFreshKeys.add(cappedRowKey(b as any))
          }
          // LORAMER_GOOGLE_RESTATE_PRUNE_V1 — THE PRUNE HALF, AND IT RUNS LAST ON PURPOSE. Everything above
          // has already been written, so the only state this can produce is "the day equals the fresh
          // payload"; a failure here leaves a SUPERSET, which is the direction DECISIONS:2094 chose.
          const dimPruned = await pruneCappedDimensionalRows({
            clientId: client.id,
            dates: dimPrunableDates,
            freshKeys: dimFreshKeys,
          })
          if (dimPruned.pruned > 0) {
            console.log(`[cron/sync] client=${client.id} platform=google dimensional PRUNED ${dimPruned.pruned} stale row(s) of ${dimPruned.examined} examined across ${dimPruned.days} day(s) — keys the fresh pull no longer carries`)
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
            // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — one RANGED query (same cost as one day), bucketed per day.
            const win = await fetchDeviceGrainWindow(grain, tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
            const byDate = new Map<string, typeof win>()
            for (const r of win) { if (!byDate.has(r.date)) byDate.set(r.date, [] as any); byDate.get(r.date)!.push(r) }
            for (const [d, dayRows] of byDate) {
            const built = buildDeviceGrainRows(grain, client.id, userEmail, d, customerId, dayRows)
            if (built.length > 0) {
              const { error: devError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
              if (devError) throw devError
              summary.rowsWritten += built.length; devRows += built.length
            }
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
                // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — ranged, bucketed per day.
                const gwin = await fetchGeoGrainWindow(grain, entity, tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
                const gByDate = new Map<string, typeof gwin>()
                for (const r of gwin) { if (!gByDate.has(r.date)) gByDate.set(r.date, [] as any); gByDate.get(r.date)!.push(r) }
                for (const [gd, gRows] of gByDate) {
                const built = buildGeoGrainRows(grain, entity, client.id, userEmail, gd, customerId, gRows)
                if (built.length > 0) {
                  const { error: geoError } = await supabaseAdmin
                    .from('metrics_daily')
                    .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                  if (geoError) throw geoError
                  summary.rowsWritten += built.length; famRows += built.length
                }
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
            // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — ranged, bucketed per day.
            const hwin = await fetchHourGrainWindow(grain, tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
            const hByDate = new Map<string, typeof hwin>()
            for (const r of hwin) { if (!hByDate.has(r.date)) hByDate.set(r.date, [] as any); hByDate.get(r.date)!.push(r) }
            for (const [hd, hRows] of hByDate) {
            const built = buildHourGrainRows(grain, client.id, userEmail, hd, customerId, hRows)
            if (built.length > 0) {
              const { error: hourError } = await supabaseAdmin
                .from('metrics_daily')
                .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
              if (hourError) throw hourError
              summary.rowsWritten += built.length; hourRows += built.length
            }
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
            // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — ranged, bucketed per day. ONE fetch per dimension feeds both grains.
            const dwin = await fetchDemographicWindow(dim, tokenRow.refresh_token, customerId, googleRestateStart, captureDate)
            const dByDate = new Map<string, typeof dwin>()
            for (const r of dwin) { if (!dByDate.has(r.date)) dByDate.set(r.date, [] as any); dByDate.get(r.date)!.push(r) }
            for (const [dd, dayRows] of dByDate) {
            for (const grain of DEMO_GRAINS) {
              const built = buildDemographicGrainRows(dim, grain, client.id, userEmail, dd, customerId, dayRows)
              if (built.length > 0) {
                const { error: demoError } = await supabaseAdmin
                  .from('metrics_daily')
                  .upsert(normalizeMetricsRows(built), { onConflict: METRICS_DAILY_CONFLICT })
                if (demoError) throw demoError
                summary.rowsWritten += built.length; demoRows += built.length
              }
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
        connFailed.add('google|' + client.id) // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — the CONNECTION failed (outer catch), not a sub-fetch
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
    await progressSection('google', __snap) // LORAMER_FORWARD_LANE_HYGIENE_V1 — tallies so far; the only record a kill leaves
  }
  } finally {
    await finalizeSection('google', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end google guard

  if (platform === 'all' || platform === 'woocommerce') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  try { // LORAMER_FORWARD_LANE_HYGIENE_V1 — finalize in the finally (a throw stamps; a kill cannot — the per-client progressSection stamp is what survives it)
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
        connFailed.add('woocommerce|' + client.id) // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — the CONNECTION failed (outer catch), not a sub-fetch
        summary.errors.push({
          clientId: client.id,
          platform: 'woocommerce',
          message,
        })
        // LORAMER_CONNECTION_HEALTH_V1 — 401/auth flips; WAF 406 / timeout does not.
        await recordConnectionResult({ platform: 'woocommerce', clientId: client.id, accountId: conn.account_id, userEmail, error: err })
      }
    }
    await progressSection('woocommerce', __snap) // LORAMER_FORWARD_LANE_HYGIENE_V1 — tallies so far; the only record a kill leaves
  }
  } finally {
    await finalizeSection('woocommerce', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end woocommerce guard

  if (platform === 'all' || platform === 'ga') {
  const __snap = { rows: summary.rowsWritten, errs: summary.errors.length } // LORAMER_CRON_RUNS_SENTINEL_V1
  try { // LORAMER_FORWARD_LANE_HYGIENE_V1 — finalize in the finally (a throw stamps; a kill cannot — the per-client progressSection stamp is what survives it)
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
      connFailed.add('ga|' + client.id) // LORAMER_CRON_DEGRADED_NOT_FAILED_V1 — the CONNECTION failed (outer catch), not a sub-fetch
      summary.errors.push({
        clientId: client.id,
        platform: 'ga',
        message,
      })
      // LORAMER_CONNECTION_HEALTH_V1 — auth-class fetch failure flips the GA credential
      // (only reached when the token was valid, so gaPropertyIdForHealth is set).
      await recordConnectionResult({ platform: 'ga', clientId: client.id, accountId: gaPropertyIdForHealth, userEmail, error: err })
    }
    await progressSection('ga', __snap) // LORAMER_FORWARD_LANE_HYGIENE_V1 — tallies so far; the only record a kill leaves
  }
  } finally {
    await finalizeSection('ga', __snap) // LORAMER_CRON_RUNS_SENTINEL_V1
  }
  } // LORAMER_CRON_PLATFORM_SPLIT_V1 — end ga guard

  summary.clientsProcessed = processedClientIds.size // FIX 5: distinct clients, not per-platform sum
  return NextResponse.json(summary)
}
