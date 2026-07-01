// LORAMER_ONBOARD_DRAIN_REGISTRY_V1
// Ordered registry of backfill "steps" the onboarding drain runs per connection, deepest-foundation-first.
// Each step = ONE bounded lap (runLap) over an EXISTING, proven, reconcile-gated, idempotent writer; the lap
// returns done=true only when that grain reaches floor / true-zero. Two resume models behind the uniform
// interface:
//   CURSOR-RESUMING (account, google_dimensional, shopify_deep, woo): the writer keeps its OWN sync_state
//     cursor + sets body.complete; one runLap = one writer call; done = body.complete.
//   STATELESS-RANGE (google_campaign, meta_placement): the writer has no cursor — the drain drives a
//     year-window loop and persists the resume point in sync_state under the step key (rangeLap below).
// A future BREADTH writer joins with ONE entry; because onboard_steps_done is a per-step SET, a new key is
// "not done" for every connection → the next drain back-fills it cohort-wide (idempotent, additive rows).
import { supabaseAdmin } from '@/lib/supabase'
import { runBackfill } from './run-backfill'
import { backfillAdapters } from './adapters'
import { runGoogleCampaignBackfill } from './google-campaign-backfill'
import { runGoogleAdGroupAdBackfill } from './google-adgroup-ad-backfill'
import { runGoogleDeviceBackfill } from './google-device-backfill'
import { runGoogleGeoBackfill, runGoogleUserGeoBackfill } from './google-geo-backfill'
import { runGoogleHourBackfill } from './google-hour-backfill'
import { runMetaPlacementBackfill } from './meta-placement-backfill'
import { runMetaCampaignBackfill } from './meta-campaign-backfill'
import { runMetaAdSetAdBackfill } from './meta-adset-ad-backfill'
import { runMetaDeviceBackfill } from './meta-device-backfill'
import { runMetaAgeGenderBackfill } from './meta-age-gender-backfill'
import { runMetaActionTypeBackfill } from './meta-action-type-backfill' // LORAMER_META_ACTION_TYPE_TAXONOMY_V1
import { runMetaVideoBackfill } from './meta-video-backfill' // LORAMER_META_VIDEO_CAPTURE_V1
import { runMetaGeoBackfill } from './meta-geo-backfill' // LORAMER_META_GEO_BACKFILL_V1
import { runGoogleDimensionalBackfill } from './google-dimensional-backfill'
import { runShopifyDeepBackfill } from './shopify-dimensional-backfill'
import { runWooCommerceBackfill } from './woocommerce-backfill'

export interface DrainConn {
  client_id: string
  platform: string
  account_id: string
}
export interface LapResult {
  done: boolean
  detail: Record<string, unknown>
}
export interface DrainStep {
  key: string
  platforms: string[]
  runLap: (conn: DrainConn, opts: { dryRun: boolean }) => Promise<LapResult>
}

const iso = (d: Date) => d.toISOString().split('T')[0]
function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}
function utcYesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return iso(d)
}
// 36-month granular floor (safety margin under the ~37mo Google/Meta granular cap; matches the proven
// google-campaign route's clamp). Pre-floor granular DateRangeErrors on Google; the writers self-clamp/empty.
function floor36(): string {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 36)
  return iso(d)
}

const WINDOW_DAYS = 365
// Shorter lap window for the geo breadth steps ONLY. Geo is the heaviest dimension (full grain family × 2 entity
// levels [campaign + ad_group] × 2 resources). Sized empirically 2026-06-27 on the heaviest active client
// (Veterinary, nationwide). BINDING constraint = MEMORY, scaling with the WINDOW (total lap volume → V8 high-water
// rss), NOT the fetch chunk size (measured: 10-day vs monthly both ~830-860MB at 60d). Measured peak-vs-window
// (geographic 2-level, 10-day chunks): 20d → 544MB/42s · 40d → 690MB/70s · 60d → 829MB/147s.
// STEP 4 free dial (2026-06-28): set to 40d on the 2GB Standard fluid instance + the bounded-concurrency runner at
// N=2 → 2×690 = 1380MB ≤ 2048−256 margin (~412MB headroom; clampConcurrency permits N=2 at 40d). 40d → 1095/40 ≈
// 27-28 laps/step to the 36-mo floor; a priority-HIGH new client (1 lap per 360s lease) reaches floor in ~27×360
// ≈ 2.7hr. The 40d sweep (~245-290s incl. fixed steps) stays under the 360s lease (migration 014). (Chunk size,
// below, bounds the per-QUERY buffer only.)
export const GEO_WINDOW_DAYS = 40 // exported: drives the drain's memory-cap N computation (step 3); STEP 4 free dial

// LORAMER_META_DEVICE_BREADTH_V1 — bounded window for the meta_device breadth step. Device runs 4 entity levels
// × 2 device fields = 8 Graph insights reports + per-day upserts per lap; a 365-day lap (like the single-report
// meta_placement) would risk overrunning the 800s ceiling (the geo/504 lesson). 60d keeps a lap ~40s (well under
// the drain headroom). FLOOR is the standard floor36() — Meta serves the device breakdown to the SAME ~37mo
// aggregate limit as every other grain (verified 2026-06-28: impression_device exact at 2023-06/~36mo; #3018
// "beyond 37 months" at 2023-05) — the assumed ~13mo breakdown floor was REFUTED, so NO special granularMonths.
const META_DEVICE_WINDOW_DAYS = 60

// LORAMER_META_AGE_GENDER_BREADTH_V1 — SHORTER window than device. age/gender runs 3 breakdown families
// (age, gender, age_gender) × 4 entity levels = 12 insights reports/lap (vs device's 8), and the age_gender cross is
// row-heavy → Gate A measured an estimated 60d LIVE lap ~154s (OVER the ~120s drain headroom under the 800s ceiling).
// 30d keeps a lap ~77s (SAFE). FLOOR = standard floor36 (demo served to the SAME ~37mo aggregate limit as device — Gate A
// reconciled EXACT at 2023-06/~36mo; #3018 only at 2023-05, which floor36's clamp never reaches). NO special granularMonths.
const META_AGE_GENDER_WINDOW_DAYS = 30

// LORAMER_META_ACTION_TYPE_TAXONOMY_V1 — action_type window. Only 4 reports/lap (4 entity levels, NO breakdown
// fan-out) but the full taxonomy is ROW-HEAVY (~36 action_types × entity × day) → 30d matches the row-heavy
// age/gender posture (tune up after a live timing). WRITE-ONLY (no reconcile). floor36.
const META_ACTION_TYPE_WINDOW_DAYS = 30

// LORAMER_META_VIDEO_CAPTURE_V1 (T1.4) — video window. The video_* metrics are FIELD-WIDEN (NOT a breakdowns
// fan-out) → only 4 insights reports/lap (one per entity level) + ONE row per entity×day (lighter than
// action_type's row-heavy taxonomy) → a WIDE 90d window stays well under the 800s ceiling. floor36 (video rides
// the same ~37mo Meta aggregate #3018 wall). VERIFY-AT-WRITER: confirm a 90d lap's wall-time at Gate B.
const META_VIDEO_WINDOW_DAYS = 90

// LORAMER_META_GEO_BACKFILL_V1 (T1.9) — geo window. 2 families (country + country,region) × 4 levels = 8 reports/lap
// (same as device), but geo_region fans WIDE (~50 US states × entities) → row-heavy like age_gender → 30d. The small
// undetermined-geo residual is FLAG-NOT-BLOCK (never dropped). DROPPED 30→20 (Gate B: one 30d geo lap ≈ 98s — fine in
// the drain's 680s budget, but the route's year-loop margin was too thin; 20d ≈ ~65s keeps both comfortable).
const META_GEO_WINDOW_DAYS = 20

async function readRangeCursor(clientId: string, key: string) {
  const { data } = await supabaseAdmin
    .from('sync_state')
    .select('backfill_earliest_date, backfill_complete')
    .eq('client_id', clientId)
    .eq('platform', key)
    .maybeSingle()
  return data as { backfill_earliest_date: string | null; backfill_complete: boolean | null } | null
}
async function writeRangeCursor(clientId: string, key: string, earliest: string, complete: boolean) {
  await supabaseAdmin.from('sync_state').upsert(
    {
      client_id: clientId,
      platform: key,
      backfill_earliest_date: earliest,
      backfill_complete: complete,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,platform' }
  )
}

type RangeWriter = (
  clientId: string,
  startDate: string,
  endDate: string,
  opts: { dryRun?: boolean }
) => Promise<{ status: number; body: Record<string, unknown> }>

// ONE bounded window lap for a STATELESS-RANGE writer, resuming via a sync_state cursor under `cursorKey`.
// windowDays defaults to WINDOW_DAYS (365 — unchanged for every existing step); geo steps pass GEO_WINDOW_DAYS.
// cursor.backfill_earliest_date = the deepest day reached so far; next lap's window end = that − 1 day.
async function rangeLap(clientId: string, cursorKey: string, writer: RangeWriter, dryRun: boolean, windowDays: number = WINDOW_DAYS): Promise<LapResult> {
  const floor = floor36()
  const st = await readRangeCursor(clientId, cursorKey)
  if (st?.backfill_complete) return { done: true, detail: { note: 'already complete' } }
  const curEnd = st?.backfill_earliest_date ? addDays(st.backfill_earliest_date, -1) : utcYesterday()
  if (curEnd < floor) {
    if (!dryRun) await writeRangeCursor(clientId, cursorKey, floor, true)
    return { done: true, detail: { note: 'reached floor', floor } }
  }
  let subStart = addDays(curEnd, -(windowDays - 1))
  if (subStart < floor) subStart = floor
  const { status, body } = await writer(clientId, subStart, curEnd, { dryRun })
  if (status !== 200) return { done: false, detail: { error: 'writer failed', status, body } }
  const reachedFloor = subStart <= floor
  if (!dryRun) await writeRangeCursor(clientId, cursorKey, subStart, reachedFloor)
  return { done: reachedFloor, detail: { range: `${subStart}→${curEnd}`, reachedFloor, body } }
}

export const DRAIN_REGISTRY: DrainStep[] = [
  {
    // FOUNDATION first. Cursor-resuming: runBackfill laps its own sync_state(platform) cursor + sets complete.
    key: 'account',
    platforms: ['google', 'meta', 'ga'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: `runBackfill(${conn.platform} account) — writer has no dryRun; live lap pending` } }
      const adapter = backfillAdapters[conn.platform]
      if (!adapter) return { done: false, detail: { error: `no account adapter for ${conn.platform}` } }
      const { body } = await runBackfill(conn.client_id, adapter)
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    key: 'google_campaign',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_campaign', runGoogleCampaignBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_GOOGLE_ADGROUP_AD_BACKFILL_V1 — depth below campaign. After google_campaign so the
    // per-day campaign anchor (already at floor cohort-wide) is present at every depth; FLAG-NOT-BLOCK
    // means it never hard-blocks even if the anchor is briefly absent. Stateless-range, same as campaign.
    key: 'google_adgroup_ad',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_adgroup_ad', runGoogleAdGroupAdBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_GOOGLE_DEVICE_BACKFILL_V1 — first BREADTH dimension (campaign × device). AFTER google_campaign
    // so the per-day campaign anchor is present (device PARTITIONS campaign spend, reconciles FLAG-NOT-BLOCK
    // vs that anchor; PMax/UNKNOWN may not sum exactly → flagged, never dropped). Stateless-range, same driver
    // as google_campaign. NO 37-mo clock conceptually, but stop-at-floor still applies (rangeLap clamps to the
    // 36-mo granular floor; empty-success at floor = done).
    key: 'google_device',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_device', runGoogleDeviceBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_GOOGLE_GEO_BACKFILL_V1 — geo BREADTH, geographic_view FAMILY (10 grains: city/metro/region/state/
    // province/county/district/postal/most_specific + country, each carrying location_type). WRITE-ONLY: NO
    // reconcile (geo is non-partitioning — location_type overlap + multi-grain; like search_term/keyword).
    // Stateless-range; after google_campaign for grouping. Stop-at-floor = empty-success (L61).
    key: 'google_geo',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_geo', runGoogleGeoBackfill as RangeWriter, dryRun, GEO_WINDOW_DAYS),
  },
  {
    // LORAMER_GOOGLE_GEO_BACKFILL_V1 — geo BREADTH, user_location_view FAMILY (9 PHYSICAL-location grains; no
    // location_type, no country — geo_target_country not served on this view). WRITE-ONLY, same posture as google_geo.
    key: 'google_user_geo',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_user_geo', runGoogleUserGeoBackfill as RangeWriter, dryRun, GEO_WINDOW_DAYS),
  },
  {
    // LORAMER_GOOGLE_HOUR_BACKFILL_V1 — hour BREADTH, BOTH entity grains (campaign×hour + ad_group×hour; ad/keyword
    // not served). FLAG-NOT-BLOCK reconcile vs the per-day campaign anchor (hour partitions campaign spend). After
    // google_campaign so the anchor exists. Default 365-day window (hour cardinality is bounded: entities × 24h,
    // far smaller than geo — confirmed small in Gate A). Stop-at-floor = empty-success (L61).
    key: 'google_hour',
    platforms: ['google'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'google_hour', runGoogleHourBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_META_CAMPAIGN_BACKFILL_FLAG_NOT_BLOCK_V2 — parent grain, BEFORE meta_placement. Reconciles
    // account SPEND per day FLAG-NOT-BLOCK (always writes; finalized days reconcile exactly, recent
    // stale-anchor days flagged-but-written so the monotonic range cursor never permanently skips them).
    // Stateless-range, same driver as google_campaign / meta_placement.
    key: 'meta_campaign',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_campaign', runMetaCampaignBackfill as RangeWriter, dryRun),
  },
  {
    key: 'meta_placement',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_placement', runMetaPlacementBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_META_ADSET_AD_BACKFILL_V1 — deepest Meta grain (ad_set + ad, one writer/one pass). Reconciles
    // account SPEND per day FLAG-NOT-BLOCK (account anchor via maybeSingle → no silent cap; full pagination
    // closes the forward limit=100 truncation; finalized days reconcile to the cent, recent stale-anchor days
    // flagged-but-written). Stateless-range, same driver as meta_campaign / meta_placement.
    key: 'meta_adset_ad',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_adset_ad', runMetaAdSetAdBackfill as RangeWriter, dryRun),
  },
  {
    // LORAMER_META_DEVICE_BREADTH_V1 — FIRST Meta BREADTH writer (device). Captures BOTH device dimensions as two
    // SEPARATE breakdown_type families (breakdown_type='device' ← impression_device; 'device_platform' ← device_platform)
    // across all 4 entity levels {account,campaign,ad_set,ad} (Meta serves device at all four; spend PARTITIONS
    // exactly → Σ device == account, FLAG-NOT-BLOCK on SPEND only; conversions=0, never reconciled — L58). Stateless-
    // range, same driver as the other meta steps. BOUNDED 60d window (META_DEVICE_WINDOW_DAYS) — NOT 365 — because the
    // 4×2 = 8-report fan-out per lap would risk overrunning maxDuration (the geo/504 lesson). Floor = standard floor36
    // (device served to the ~37mo aggregate limit — verified 2026-06-28; the assumed ~13mo breakdown floor was REFUTED).
    // Placed AFTER the meta DEPTH grains (breadth after depth). One entry → next meta drain back-fills the cohort.
    key: 'meta_device',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_device', runMetaDeviceBackfill as RangeWriter, dryRun, META_DEVICE_WINDOW_DAYS),
  },
  {
    // LORAMER_META_AGE_GENDER_BREADTH_V1 — Meta demographics breadth (age + gender + the age,gender cross). THREE
    // SEPARATE breakdown_type families {age, gender, age_gender} across all 4 entity levels {account,campaign,ad_set,ad};
    // each PARTITIONS account spend exactly → Σ family == account, FLAG-NOT-BLOCK on SPEND only (conversions=0, never
    // reconciled — L58). Stateless-range. 30d window (META_AGE_GENDER_WINDOW_DAYS) — SHORTER than meta_device's 60d
    // because the 3×4=12-report fan-out + the row-heavy cross would push a 60d lap ~154s (over the 800s headroom);
    // 30d ≈ 77s (Gate A timing). Floor = standard floor36 (demo served to the 37mo limit, Gate A). After meta_device.
    key: 'meta_age_gender',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_age_gender', runMetaAgeGenderBackfill as RangeWriter, dryRun, META_AGE_GENDER_WINDOW_DAYS),
  },
  {
    // LORAMER_META_ACTION_TYPE_TAXONOMY_V1 (T1.1) — Meta FULL conversion/action taxonomy. ONE breakdown_type
    // ('action_type') across all 4 entity levels {account,campaign,ad_set,ad}; one row per (entity × action_type ×
    // day) with per-action conversions/value + Meta's non-derivable cost_per_action_type/purchase_roas/website_purchase_roas
    // in extra. RIDES-EXISTING (actions/action_values already in the insights fields) + FIELD-WIDEN (the cost/ROAS
    // fields, SAME call — no new calls, no row multiplication). WRITE-ONLY (action_type does NOT partition spend;
    // conversions don't sum to account by dedup → NEVER reconciled, unlike age/gender). Stateless-range; floor36; 30d
    // window. After meta_age_gender → the next meta drain back-fills the cohort to floor automatically (Meta = no quota).
    key: 'meta_action_type',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_action_type', runMetaActionTypeBackfill as RangeWriter, dryRun, META_ACTION_TYPE_WINDOW_DAYS),
  },
  {
    // LORAMER_META_VIDEO_CAPTURE_V1 (T1.4) — Meta VIDEO metric family. ONE row per entity×day across all 4 levels
    // {account,campaign,ad_set,ad} (live-probed Foam OH 2026-06-30 — all 4 serve video), breakdown_type='video',
    // the 10 video metrics in DEDICATED COLUMNS (Layer-1 storage model, migration 023). FIELD-WIDEN on the insights
    // call (NOT a breakdowns= dim → 4 reports/lap → 90d window). WRITE-ONLY (non-partition; spend lives on the base
    // row → NEVER reconciled). floor36 (37mo aggregate wall). Stateless-range, same driver as the other meta steps.
    // After meta_action_type → the next meta drain back-fills the cohort to floor automatically (Meta = no quota).
    key: 'meta_video',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_video', runMetaVideoBackfill as RangeWriter, dryRun, META_VIDEO_WINDOW_DAYS),
  },
  {
    // LORAMER_META_GEO_BACKFILL_V1 (T1.9) — Meta GEO breadth: geo_country (breakdowns=country) + geo_region
    // (breakdowns=country,region → ISO composite "US-AL"). All 4 levels serve geo (live-probed). FLAG-NOT-BLOCK on
    // spend vs the account anchor (geo NEAR-partitions; undetermined-geo residual flagged-not-dropped). breakdown_type
    // 'geo_country'/'geo_region' on the 7-col key, NO migration. 30d window (verify-at-Gate-B). floor36. After meta_video.
    key: 'meta_geo',
    platforms: ['meta'],
    runLap: (conn, { dryRun }) => rangeLap(conn.client_id, 'meta_geo', runMetaGeoBackfill as RangeWriter, dryRun, META_GEO_WINDOW_DAYS),
  },
  {
    key: 'google_dimensional',
    platforms: ['google'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: 'runGoogleDimensionalBackfill — writer has no dryRun; live lap pending' } }
      const { body } = await runGoogleDimensionalBackfill(conn.client_id, {})
      return { done: body?.complete === true || body?.done === true, detail: body }
    },
  },
  {
    key: 'shopify_deep',
    platforms: ['shopify'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: 'runShopifyDeepBackfill — writer has no dryRun; live lap pending' } }
      const { body } = await runShopifyDeepBackfill(conn.client_id)
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant/SKU DEPTH backfill (Shopify). Re-walks the SAME deep writer
    // under a SEPARATE cursor namespace ('shopify_variant') so already-complete 'shopify_deep' clients re-emit
    // depth rows incl. the new variant grain (idempotent, additive). After shopify_deep (depth before this breadth).
    // The deep writer's Σ product == account AND Σ variant == account HALT guards every day. NEW key → cohort-wide.
    key: 'shopify_variant',
    platforms: ['shopify'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: "runShopifyDeepBackfill(cursor='shopify_variant') — writer has no dryRun; live lap pending" } }
      const { body } = await runShopifyDeepBackfill(conn.client_id, { cursorPlatform: 'shopify_variant' })
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    // LORAMER_SHOPIFY_MONEY_SURFACE_V1 (T1.5) — Shopify full-order money surface (gross/discounts/taxes/shipping/
    // tips split beyond NET) onto the account row's extra.money. Re-walks the SAME deep writer under a SEPARATE
    // cursor namespace ('shopify_money') so already-complete 'shopify_deep' clients re-emit account rows carrying
    // the money split (idempotent, additive; money rides shopifyAccountExtra so NO row-builder change; the query-
    // widen is already in fetchShopifyIntelligence). After 'shopify_variant'. NEW key → cohort-wide back-drain.
    // Money coverage == account coverage by construction (same fetch); netSales == currentSubtotal, byte-identical.
    key: 'shopify_money',
    platforms: ['shopify'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: "runShopifyDeepBackfill(cursor='shopify_money') — writer has no dryRun; live lap pending" } }
      const { body } = await runShopifyDeepBackfill(conn.client_id, { cursorPlatform: 'shopify_money' })
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    // WOO last + gentlest (live self-hosted). Its own circuit-breaker + claim already guard the store.
    key: 'woo',
    platforms: ['woocommerce'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: 'runWooCommerceBackfill — writer has no dryRun; live lap pending' } }
      const { body } = await runWooCommerceBackfill(conn.client_id, {})
      if (body?.skipped) return { done: false, detail: { note: 'woo writer claim held by another invocation', body } }
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    // LORAMER_VARIANT_SKU_CAPTURE_T1_7_V1 — variant/SKU DEPTH backfill (Woo). Re-walks the SAME backfill writer
    // under a SEPARATE cursor namespace ('woocommerce_variant') with its OWN claim/breaker row so already-complete
    // 'woo' clients re-emit depth rows incl. the new variant grain (idempotent, additive). After 'woo'; gentle-
    // citizen throttle + breaker carry over. NEW key → not-done for every connection → cohort-wide back-drain.
    key: 'woo_variant',
    platforms: ['woocommerce'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: "runWooCommerceBackfill(cursor='woocommerce_variant') — writer has no dryRun; live lap pending" } }
      const { body } = await runWooCommerceBackfill(conn.client_id, { cursorPlatform: 'woocommerce_variant' })
      if (body?.skipped) return { done: false, detail: { note: 'woo variant writer claim held by another invocation', body } }
      return { done: body?.complete === true, detail: body }
    },
  },
  {
    // LORAMER_ECOM_MONEY_SURFACE_V1 (T1.6) — Woo full-order money surface (gross/discounts/taxes/shipping/tips
    // split beyond NET) onto the account row's extra.money. Re-walks the SAME backfill writer under a SEPARATE
    // cursor namespace ('woocommerce_money') with its OWN claim/breaker row so already-complete 'woo' clients
    // re-emit account rows carrying the money split (idempotent, additive; money rides shopifyAccountExtra so NO
    // fetch/row-builder change — REST already returns every money field). After 'woo_variant'; gentle-citizen
    // throttle + breaker carry over. NEW key → not-done for every connection → cohort-wide back-drain. Money
    // coverage == base coverage by construction (same fetch + false-zero discipline); its cursor honestly reports
    // complete=FALSE at any store-side wall (e.g. shelleykyle pre-2018 deep tail) — no false-completeness.
    key: 'woocommerce_money',
    platforms: ['woocommerce'],
    runLap: async (conn, { dryRun }) => {
      if (dryRun) return { done: false, detail: { plan: "runWooCommerceBackfill(cursor='woocommerce_money') — writer has no dryRun; live lap pending" } }
      const { body } = await runWooCommerceBackfill(conn.client_id, { cursorPlatform: 'woocommerce_money' })
      if (body?.skipped) return { done: false, detail: { note: 'woo money writer claim held by another invocation', body } }
      return { done: body?.complete === true, detail: body }
    },
  },
]

// The full step-key set for a platform — a connection is DONE when onboard_steps_done ⊇ this set.
export function requiredSteps(platform: string): string[] {
  return DRAIN_REGISTRY.filter((s) => s.platforms.includes(platform)).map((s) => s.key)
}
// The next incomplete step for a connection, in registry (deepest-first) order. null = already complete.
export function nextStep(platform: string, done: string[]): DrainStep | null {
  for (const step of DRAIN_REGISTRY) {
    if (step.platforms.includes(platform) && !done.includes(step.key)) return step
  }
  return null
}
